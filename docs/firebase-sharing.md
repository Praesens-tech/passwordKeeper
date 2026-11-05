# Backup e compartilhamento no Firebase

O projeto password-keeper-mpb-2026 usa Firebase Authentication e Firestore na região southamerica-east1. O login é por e-mail e senha, com confirmação obrigatória do e-mail. A sessão da conta fica apenas em memória no app.

O cofre principal continua local em um arquivo .keep. Com uma conta autenticada, o usuário pode enviar uma cópia criptografada para personalVaults/{uid}. Compartilhamentos usam documentos separados em sharedVaults/{id}.

## Proteção dos dados

- O conteúdo do cofre é cifrado no cliente com AES-256-GCM antes de sair do dispositivo.
- O Firestore recebe ciphertext e metadados de acesso, nunca VaultData em texto claro ou a senha mestra.
- As regras em firestore.rules restringem backup pessoal ao UID autenticado com e-mail confirmado.
- Documentos compartilhados continuam sujeitos a regras de proprietário, membro e editor.
- O cliente limita o envelope cifrado a 900.000 bytes para ficar abaixo do limite de 1 MiB por documento.
- O aplicativo não acessa o Google Drive.

## Contas existentes e migração

A primeira gravação de um backup é create-only. Se já houver um backup para a conta, o app não o sobrescreve sem conhecer a revisão; restaure-o usando a senha mestra antes de sincronizar alterações locais.

Arquivos locais .keep continuam abrindo normalmente. Backups pessoais ou compartilhamentos que só existam no Google Drive precisam ser baixados e importados como arquivo local; o app não acessa mais o Drive.

## Limitações

O formulário do app exige senha de conta com pelo menos 12 caracteres e confirmação de e-mail; a política de senha correspondente ainda precisa ser configurada no Firebase para também ser aplicada no servidor. MFA ainda não está habilitada: TOTP do Firebase exige upgrade do projeto para Firebase Authentication with Identity Platform. O fluxo Firestore também precisa de validação em aparelho Android físico antes de declarar suporte de produção.
