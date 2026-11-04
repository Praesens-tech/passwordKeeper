# Firebase para compartilhamento e sincronização

O projeto Firebase `password-keeper-mpb-2026` está configurado para autenticação Google e Firestore em `southamerica-east1` (São Paulo). Compartilhamentos de cofre, grupo ou senha usam documentos `sharedVaults/{id}` com envelope cifrado v2. O documento é descoberto pelo e-mail Google verificado do destinatário; o destinatário também precisa da senha de compartilhamento para abrir o conteúdo.

O cofre pessoal pode ser copiado para o Firebase pela opção **Arquivo → Migrar cofre para Firebase**. Essa cópia sincroniza junto com o arquivo local e o backup opcional no Google Drive. O Google Drive continua disponível para sincronizar o cofre pessoal, mas o app não cria nem lê documentos de compartilhamento nele.

## Segurança e formato

- O cliente deriva a sessão Firebase da credencial Google já existente; a sessão Firebase fica somente em memória.
- O app envia o envelope cifrado AES-GCM, nunca `VaultData` em texto claro nem a senha mestra.
- `ownerUid`, `memberUids` e `editorUids` usam Firebase UIDs, nunca e-mails.
- Revisões incrementais e transações condicionais evitam sobrescrita silenciosa quando dois dispositivos alteram o mesmo documento.
- As regras em `firestore.rules` exigem autenticação Google com e-mail verificado e restringem leitura aos membros; somente o dono altera permissões.
- A criação de documentos usa operação create-only e a migração relê e compara o ciphertext antes de vincular o cofre.
- O cliente limita o ciphertext a 900.000 bytes para manter margem abaixo do limite Firestore de 1 MiB.

## Migração do cofre pessoal existente

Use **Arquivo → Migrar cofre para Firebase** com o cofre pessoal desbloqueado e a conta Google proprietária conectada. O app copia e verifica o envelope cifrado. O arquivo `.keep` local e o backup no Drive permanecem intactos. Documentos colaborativos antigos `pk-collab-*.keep` do Drive não são importados automaticamente; compartilhe novamente pelo app para criar os documentos no Firebase.

## Limitação Android

A integração usa o SDK Web Firebase. A compatibilidade do transporte Firestore com Tauri Android ainda precisa de validação no dispositivo; o app atual encaminha outras chamadas HTTP Android via JNI, enquanto o SDK Firebase pode usar transporte próprio.
