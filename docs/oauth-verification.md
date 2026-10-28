# Password Keeper — preparação da verificação OAuth

Status: material preparado; submissão e aprovação pelo Google pendentes.

## Dados para o Google Auth Platform

- Nome: Password Keeper (usar o mesmo nome nos clientes e na tela de consentimento).
- Homepage: https://passwordkeeper.praesens.tech/
- Política de privacidade: https://passwordkeeper.praesens.tech/privacy.html
- Contato do desenvolvedor exibido no aviso atual: mpblima@gmail.com.
- Código-fonte: https://github.com/Praesens-tech/passwordKeeper
- Plataformas: desktop (Windows, Linux, macOS) e Android.
- Escopos usados pelo código: `https://www.googleapis.com/auth/drive` e `https://www.googleapis.com/auth/userinfo.email`.

## Explicação técnica para a revisão

Password Keeper is a desktop and Android password vault. Users can keep their
vault locally or optionally connect their Google Drive for encrypted backup,
sync and collaboration. Vault contents are encrypted on the user's device
before upload. The master password is not sent to Google or to the developer.
The app communicates directly with Google APIs from the user's device. There
is no developer-operated server receiving vault contents or OAuth tokens.

The current Drive integration discovers existing and shared `.keep` vault
files, downloads encrypted vaults, saves changes, creates separate encrypted
collaboration files, manages user-requested sharing permissions and polls the
Drive Changes API. Email identifies the connected account and collaborators.
Google user data is used for these user-facing features, not advertising or
general-purpose AI model training.

The current custom selection screen lists existing Drive vaults without a
Google Picker per-file authorization step. We acknowledge that `drive.file`
supports the relevant Drive operations for files authorized to the app.
Migrating requires adapting selection/authorization for existing and shared
vaults, not merely replacing the scope string. The current full-Drive scope
must be explicitly justified and approved; approval is not guaranteed.

## Fluxo de dados e retenção

1. Google OAuth no navegador externo/AppAuth entrega tokens ao app no dispositivo.
2. Tokens são persistidos no armazenamento de configuração Tauri no dispositivo.
3. O app lê metadados e arquivos criptografados diretamente do Google Drive.
4. Cofres são descriptografados em memória; gravações são criptografadas antes do envio.
5. Convites enviam ao Google o e-mail e a permissão escolhidos pelo usuário.
6. Desconectar remove o token local; revogação no Google e exclusão dos arquivos são ações separadas.
7. A consulta de atualizações acessa o GitHub, sem incluir o conteúdo do cofre.

## Pendências no console do proprietário

1. Selecionar o projeto que contém os clientes OAuth realmente usados pelo app.
2. Conferir Branding: nome, contato, homepage e política pública; publicar o branding após verificação.
3. Conferir propriedade e elegibilidade dos domínios autorizados conforme as exigências exibidas no console. A existência de um site no GitHub Pages ou de uma propriedade URL-prefix no Search Console não comprova, isoladamente, que todos os requisitos de domínio OAuth foram atendidos.
4. Declarar em Data Access exatamente os escopos usados pelo app.
5. Conferir Audience e configuração de produção. Publicar o app não substitui a verificação dos escopos.
6. No Verification Center, fornecer justificativas, documentação e vídeo; responder às exigências do Google. A ausência de servidor próprio deve ser informada para a avaliação de eventual exigência de auditoria, sem declarar isenção antecipadamente.
7. Confirmar que o Google aprovou o acesso aos escopos solicitados; depois testar uma autorização com uma conta nova.

## Roteiro do vídeo exigido pelo Google

Gravar em inglês, com dados de teste. Não mostrar senhas ou tokens.

1. Mostrar a aplicação e a homepage com o link da política.
2. Mostrar os clientes OAuth relevantes no projeto (sem revelar client secrets).
3. Mostrar o fluxo de consentimento, o nome do app e o client ID na URL.
4. Demonstrar criar e sincronizar um cofre de teste.
5. Demonstrar localizar e abrir um cofre existente.
6. Demonstrar compartilhar um cofre de teste e acessar pela conta colaboradora.
7. Demonstrar alterações sendo sincronizadas e a exclusão solicitada pelo usuário.
8. Mostrar desconexão e como revogar o acesso na Conta do Google.
9. Incluir os clientes desktop e Android usados em produção, conforme exigência do revisor.

Publicar o vídeo como não listado e inserir o link no campo solicitado pelo
Google. O envio não pode ser concluído apenas pelo GitHub CLI: depende do
proprietário/editor autenticado no Google Cloud e da revisão do Google.

## Referências oficiais

- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
