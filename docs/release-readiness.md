# Release Readiness

Checklist para promover o Password Keeper de beta para versão pública (v1.0).

---

## Estado Atual

- [x] Build web validado (`npm run build` — zero erros TypeScript)
- [x] Backend Tauri validado (`cargo check`)
- [ ] Testes automatizados executados para conta Firebase e backup pessoal
- [x] Auditoria npm sem vulnerabilidades em dependências de produção (`npm audit --omit=dev`)
- [ ] Backup pessoal criptografado no Firestore com conta e e-mail verificado
- [x] Compartilhamento colaborativo no Firebase/Firestore com envelope multi-slot e controle de acesso
- [x] Pipeline de segurança CI: npm audit + Gitleaks por PR; PR Gating Aikido no dashboard
- [x] Workflow de release por tag `v*` configurado para Linux, Windows, macOS, Android

---

## Bloqueadores Para v1.0

### Infraestrutura (requer ação humana)

- [ ] Configurar GitHub Secrets:
  - `ANDROID_KEYSTORE_B64` — keystore Android em Base64 (`base64 -w0 release.jks`)
  - `ANDROID_KEY_ALIAS`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD`

- [ ] Gerar e testar builds reais instalados por plataforma:
  - Linux (`.AppImage` ou `.deb`)
  - Windows (`.msi` ou `.exe`)
  - macOS (`.dmg`) — requer Developer ID e notarização
  - Android (`.apk`) — requer keystore permanente

- [ ] Configurar assinatura macOS: Developer ID + notarização no workflow (`release.yml`)
- [ ] Avaliar assinatura Windows: certificado EV se distribuição via store/download direto

- [x] Habilitar Firebase Authentication por e-mail/senha e publicar regras Firestore
- [ ] Configurar política Firebase de senha forte no servidor
- [ ] Ativar MFA TOTP no Firebase Authentication com Identity Platform
- [x] Publicar política de privacidade
- [ ] Publicar termos de uso
- [ ] Página de suporte com e-mail de contato

### Google Play

- [x] Pacote Android fixo: `com.passwordkeeper.vault`
- [x] `targetSdk` configurado para API 36
- [x] Página pública para solicitar exclusão da conta e dos dados
- [x] Link para solicitar exclusão disponível no app durante criação e acesso à conta
- [x] Workflow gera APK para instalação direta e AAB assinado para Google Play
- [ ] Revisar continuidade da chave de assinatura no Play App Signing para atualizar instalações por APK
- [ ] Criar o app no Play Console e enviar o AAB para teste interno
- [ ] Para a conta pessoal criada em 2026: teste fechado com 12 participantes por 14 dias consecutivos
- [ ] Preencher Data safety, App access, classificação indicativa e ficha da loja
- [ ] Preparar capturas de tela Android para a ficha da loja

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
- [ ] Criar uma conta e confirmar o e-mail
- [ ] Enviar/restaurar backup pessoal criptografado no Firebase
- [ ] Fechar e reabrir cofre pessoal
- [ ] Compartilhar entrada/grupo/cofre com outra conta
- [ ] Abrir compartilhamento como colaborador (com sharePassword)
- [ ] Editar como editor — verificar sync em até 5s no proprietário
- [ ] Revogar compartilhamento
- [ ] Trocar senha mestra — verificar que cofre reabre com nova senha
- [ ] Auto-lock: aguardar 5 min sem interação — cofre deve bloquear
- [ ] Testar em Android: login Firebase, salvar local, backup e compartilhamento

---

## Critério de Promoção para v1.0

Uma tag só deve ser marcada como v1.0 quando:

1. Todos os gates automatizados passam em CI
2. Build instalado e testado em pelo menos uma máquina real por plataforma alvo
3. Artefatos assinados com chaves permanentes (Android obrigatório; macOS/Windows conforme distribuição)
4. Firebase Authentication e MFA TOTP configurados e validados
5. Política de privacidade, termos e suporte publicados
