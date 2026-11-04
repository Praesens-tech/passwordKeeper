# Release Readiness

Checklist para promover o Password Keeper de beta para versão pública (v1.0).

---

## Estado Atual

- [x] Build web validado (`npm run build` — zero erros TypeScript)
- [x] Backend Tauri validado (`cargo check`)
- [x] 28 testes automatizados passando (criptografia, compartilhamento, auto-lock, polling)
- [x] Auditoria npm sem vulnerabilidades em dependências de produção (`npm audit --omit=dev`)
- [x] Compartilhamento colaborativo no Firebase/Firestore com envelope multi-slot e permissão por e-mail Google verificado
- [x] Sincronização quasi-realtime do cofre pessoal via Drive Changes API; compartilhamentos usam listener Firestore
- [x] Pipeline de segurança CI: npm audit + Gitleaks por PR; PR Gating Aikido no dashboard
- [x] Workflow de release por tag `v*` configurado para Linux, Windows, macOS, Android

---

## Bloqueadores Para v1.0

### Infraestrutura (requer ação humana)

- [ ] Configurar GitHub Secrets:
  - `VITE_GOOGLE_CLIENT_ID`
  - `VITE_GOOGLE_CLIENT_SECRET`
  - `VITE_GOOGLE_ANDROID_CLIENT_ID`
  - `ANDROID_KEYSTORE_B64` — keystore Android em Base64 (`base64 -w0 release.jks`)
  - `ANDROID_KEY_ALIAS`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD`

- [ ] Gerar e testar builds reais instalados por plataforma:
  - Linux (`.AppImage` ou `.deb`)
  - Windows (`.msi` ou `.exe`)
  - macOS (`.dmg`) — requer Developer ID e notarização
  - Android (`.apk`) — requer keystore permanente

- [ ] Configurar assinatura macOS: Developer ID + notarização no workflow (`release.yml`)
- [ ] Avaliar assinatura Windows: certificado EV se distribuição via store/download direto

### OAuth Google (requer ação humana)

- [ ] Criar OAuth Client ID de produção:
  - Desktop: redirect `http://localhost:8899`
  - Android: package `com.passwordkeeper.vault` + SHA-1 da keystore final

- [ ] Decidir escopo OAuth:
  - **Manter `drive`** → completar verificação de segurança do Google (semanas)
  - **Migrar para `drive.file`** → implementar Google Picker (elimina verificação)
  - **Importação por arquivo** → sem listagem global, sem verificação necessária

- [ ] Publicar política de privacidade (URL pública obrigatória para OAuth)
- [ ] Publicar termos de uso
- [ ] Página de suporte com e-mail de contato
- [ ] Submeter verificação OAuth (ou limitar a ≤100 usuários de teste)

---

## Gates Automatizados (CI — rodam em todo PR)

```bash
npm test -- --run       # 28 testes
npm run build           # TypeScript + Vite
cd src-tauri && cargo check
npm audit --omit=dev
```

Para validar empacotamento local antes de criar tag:

```bash
npm run tauri build
```

---

## Checklist de Teste Manual (antes da v1.0)

- [ ] Criar cofre novo
- [ ] Salvar local (`.keep`)
- [ ] Abrir cofre local
- [ ] Conectar Google Drive para o cofre pessoal (opcional)
- [ ] Salvar cofre pessoal no Drive
- [ ] Fechar e reabrir cofre pessoal
- [ ] Compartilhar entrada/grupo/cofre com outra conta
- [ ] Abrir compartilhamento como colaborador (com sharePassword)
- [ ] Editar como editor — verificar sync em até 5s no proprietário
- [ ] Revogar compartilhamento
- [ ] Trocar senha mestra — verificar que cofre reabre com nova senha
- [ ] Auto-lock: aguardar 5 min sem interação — cofre deve bloquear
- [ ] Testar em Android: OAuth, salvar, abrir e compartilhar via Firebase

---

## Critério de Promoção para v1.0

Uma tag só deve ser marcada como v1.0 quando:

1. Todos os gates automatizados passam em CI
2. Build instalado e testado em pelo menos uma máquina real por plataforma alvo
3. Artefatos assinados com chaves permanentes (Android obrigatório; macOS/Windows conforme distribuição)
4. OAuth de produção verificado pelo Google ou uso limitado a teste fechado (≤100 usuários)
5. Política de privacidade, termos e suporte publicados
