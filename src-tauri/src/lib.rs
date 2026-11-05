#[cfg(not(target_os = "android"))]
use base64::Engine;

use tauri::Manager;

// ─── HTTP via Java/JNI (Android) ──────────────────────────────────────────────
//
// No Android, código NDK não consegue fazer DNS nem sockets TCP para a internet:
//   - getaddrinfo → EAI_NONAME  (não configurado em threads tokio)
//   - UDP porta 53 → EPERM      (bloqueado pelo kernel Android)
//   - InetAddress via JNI → UnknownHostException (threads JNI-attached têm restrições)
//
// Solução definitiva: fazer o HTTP inteiramente em Kotlin (NativeHttp.kt),
// que usa HttpURLConnection do Android — DNS, TLS e routing funcionam corretamente.
// O JavaVM é obtido via ndk-context, inicializado pelo wry/Tauri.

#[cfg(target_os = "android")]
async fn android_http_request(
    method: String,
    url: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
) -> Result<String, String> {
    use jni::{
        objects::{JClass, JObject, JString, JValue},
        JavaVM,
    };

    let headers_json =
        serde_json::to_string(&headers).map_err(|e| format!("headers: {}", e))?;

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let android_ctx = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(android_ctx.vm().cast()) }
            .map_err(|e| format!("JavaVM: {}", e))?;
        let mut env = vm.attach_current_thread()
            .map_err(|e| format!("attach: {}", e))?;

        // Threads JNI-nativas usam o bootstrap ClassLoader do Android, que não conhece
        // classes do app. Precisamos usar o ClassLoader do Context do app.
        let ctx_obj = unsafe {
            JObject::from_raw(android_ctx.context() as jni::sys::jobject)
        };
        let loader = env.call_method(
            &ctx_obj, "getClassLoader", "()Ljava/lang/ClassLoader;", &[],
        ).map_err(|e| { let _ = env.exception_clear(); format!("getClassLoader: {}", e) })?
        .l().map_err(|e| e.to_string())?;

        let class_name = env.new_string("com.passwordkeeper.vault.NativeHttp")
            .map_err(|e| e.to_string())?;
        let loaded = env.call_method(
            &loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&*class_name)],
        ).map_err(|e| { let _ = env.exception_clear(); format!("loadClass: {}", e) })?
        .l().map_err(|e| e.to_string())?;
        let native_http_class = JClass::from(loaded);

        let jmethod  = env.new_string(&method).map_err(|e| e.to_string())?;
        let jurl     = env.new_string(&url).map_err(|e| e.to_string())?;
        let jheaders = env.new_string(&headers_json).map_err(|e| e.to_string())?;
        let jbody    = env.new_string(body.as_deref().unwrap_or(""))
            .map_err(|e| e.to_string())?;
        let has_body: u8 = if body.is_some() { 1 } else { 0 };

        let result = env.call_static_method(
            &native_http_class,
            "request",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Z)Ljava/lang/String;",
            &[
                JValue::Object(&ctx_obj),
                JValue::Object(&*jmethod),
                JValue::Object(&*jurl),
                JValue::Object(&*jheaders),
                JValue::Object(&*jbody),
                JValue::Bool(has_body),
            ],
        );

        match result {
            Ok(r) => {
                let jobj = r.l().map_err(|e| e.to_string())?;
                let s: String = env.get_string(&JString::from(jobj))
                    .map_err(|e| e.to_string())?
                    .into();
                Ok(s)
            }
            Err(e) => {
                let msg = if env.exception_check().unwrap_or(false) {
                    if let Ok(exc) = env.exception_occurred() {
                        let _ = env.exception_clear();
                        env.call_method(&exc, "toString", "()Ljava/lang/String;", &[])
                            .ok()
                            .and_then(|v| v.l().ok())
                            .filter(|o| !o.is_null())
                            .and_then(|o| {
                                let js = JString::from(o);
                                env.get_string(&js).ok().map(String::from)
                            })
                            .unwrap_or_else(|| e.to_string())
                    } else {
                        e.to_string()
                    }
                } else {
                    e.to_string()
                };
                Err(format!("NativeHttp: {}", msg))
            }
        }
    })
    .await
    .map_err(|e| format!("spawn_blocking: {}", e))?
}

/// Faz requisições HTTP pelo lado nativo.
/// Android: usa HttpURLConnection via JNI (DNS/sockets NDK não funcionam).
/// Desktop: usa reqwest diretamente.
#[tauri::command]
async fn native_fetch(
    method: String,
    url: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
) -> Result<String, String> {
    // Android: delega para o Kotlin (HttpURLConnection) e retorna o JSON direto
    #[cfg(target_os = "android")]
    return android_http_request(method, url, headers, body).await;

    // Desktop: usa reqwest
    #[cfg(not(target_os = "android"))]
    {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("{:?}", e))?;

    let req = match method.to_uppercase().as_str() {
        "GET"    => client.get(&url),
        "POST"   => client.post(&url),
        "PUT"    => client.put(&url),
        "PATCH"  => client.patch(&url),
        "DELETE" => client.delete(&url),
        m        => return Err(format!("Método não suportado: {}", m)),
    };
    let req = headers.iter().fold(req, |r, (k, v)| r.header(k, v));
    let req = if let Some(b) = body { req.body(b) } else { req };

    let res = req.send().await.map_err(|e| format!("{:?}", e))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| format!("{:?}", e))?;

    Ok(serde_json::json!({ "status": status, "body": text }).to_string())
    } // end #[cfg(not(target_os = "android"))]
}

/// Abre uma URL no browser padrão do sistema usando tauri-plugin-opener.
#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    open_url_with_opener(&app, &url)
}

fn open_url_with_opener(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

// ─── File I/O (desktop only) ──────────────────────────────────────────────────

/// Abre diálogo para selecionar imagem e retorna como data-URL base64.
/// Não disponível no Android (sem suporte a rfd).
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn pick_and_read_image() -> Result<Option<String>, String> {
    let path = tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("Imagens (PNG, JPG)", &["png", "jpg", "jpeg"])
            .pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    match path {
        None => Ok(None),
        Some(p) => {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("jpg").to_lowercase();
            let mime = if ext == "png" { "image/png" } else { "image/jpeg" };
            let data = tokio::fs::read(&p).await.map_err(|e| e.to_string())?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            Ok(Some(format!("data:{};base64,{}", mime, b64)))
        }
    }
}

/// Stub para Android — sem file picker nativo via rfd.
#[cfg(target_os = "android")]
#[tauri::command]
async fn pick_and_read_image() -> Result<Option<String>, String> {
    Ok(None)
}

/// Escreve conteúdo de texto em um arquivo.
#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content.as_bytes()).await.map_err(|e| e.to_string())
}

/// Lê conteúdo de texto de um arquivo.
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_default_vault_path(app: tauri::AppHandle, file_name: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Nao foi possivel obter diretorio do app: {}", e))?;

    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Nao foi possivel preparar diretorio do cofre: {}", e))?;

    let safe_name = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| value.to_ascii_lowercase().ends_with(".keep"))
        .unwrap_or("meu-cofre.keep");
    Ok(dir.join(safe_name).to_string_lossy().into_owned())
}

/// Encerra o processo imediatamente.
#[tauri::command]
fn exit_app() {
    std::process::exit(0);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    let builder = builder.invoke_handler(tauri::generate_handler![
        open_url,
        native_fetch,
        write_file,
        read_file,
        get_default_vault_path,
        pick_and_read_image,
        exit_app,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o Password Keeper");
}
