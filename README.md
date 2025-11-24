# 🎵 Synesthesia Server (Backend)

Este é o servidor backend para o projeto Synesthesia Lab. Ele atua como um middleware inteligente entre a aplicação Frontend (React) e a API de Inteligência Artificial da Music.ai.

O objetivo deste servidor é receber arquivos de áudio, enviá-los para processamento na nuvem e retornar os links separados dos instrumentos (Stems) para a visualização 3D.

## 🚀 Funcionalidades

* Upload de Áudio: Recebe arquivos MP3/WAV do frontend via multipart/form-data.

* Integração Music.ai: Gerencia todo o ciclo de vida da API (Upload -> Job -> Polling -> Resultado).

* Separação de 5 Stems: Configurado para extrair Bateria, Baixo, Voz, Guitarra e Piano.

* Modo de Segurança (Fallback): Se a API falhar, a chave expirar ou o workflow estiver errado, o servidor ativa automaticamente um Modo Demonstração, retornando áudios de teste para garantir que a apresentação do projeto nunca falhe.

* Mapeamento Inteligente: Traduz os nomes dos outputs da IA (ex: "bateria", "drums") para o formato padrão esperado pelo frontend.

## 🛠️ Tecnologias

* Node.js & Express: Servidor HTTP.

* Axios: Requisições HTTP para a Music.ai.

* Multer: Gerenciamento de upload de arquivos temporários.

* Dotenv: Gerenciamento de variáveis de ambiente seguras.

## 📦 Instalação

1. Certifique-se de ter o Node.js instalado.

2. Entre na pasta do servidor:

    ```bach
    cd synesthesia-server
    ```

3. Instale as dependências:

    ```bach
    npm install
    ```

## ⚙️ Configuração (Variáveis de Ambiente)

Você precisa criar um arquivo .env na raiz da pasta synesthesia-server para guardar suas credenciais secretas.

1. Crie um arquivo chamado .env.

2. Adicione o seguinte conteúdo:

```bach
MUSIC_AI_KEY=sua_chave_api_aqui
WORKFLOW_ID=seu_id_de_workflow_aqui
```

### Como obter o WORKFLOW_ID?

1. Acesse o Dashboard da Music.ai.

2. Crie um novo Workflow.

3. Adicione um bloco de Input.

4. Adicione um bloco de Source Separation (ex: Demucs).

5. Conecte o Input ao Separator.

6. Adicione blocos de Output para cada saída do separador e nomeie-os (ex: bateria, baixo, vozes, guitarra, piano).

7. Salve e copie o ID do Workflow gerado.

## ▶️ Como Rodar

Para iniciar o servidor em modo de desenvolvimento:

```bach
node index.js
```

O servidor iniciará na porta 3001:

```bach
🚀 SERVIDOR RODANDO (3001)
```

## 📡 Documentação da API

```POST /separate```

Envia um arquivo de áudio para separação.

* URL: http://localhost:3001/separate

* Método: POST

* Body (Form-Data):

    * audio: Arquivo de áudio (MP3/WAV).

**Exemplo de Resposta (Sucesso):**

```bach
{
  "success": true,
  "stems": {
    "drums": "https://link-da-music-ai/drums.wav",
    "bass": "https://link-da-music-ai/bass.wav",
    "vocals": "https://link-da-music-ai/vocals.wav",
    "guitar": "https://link-da-music-ai/guitar.wav",
    "piano": "https://link-da-music-ai/piano.wav"
  }
}
```

**Exemplo de Resposta (Modo Demo / Erro na API):**

```bach
{
  "success": true,
  "isDemo": true,
  "stems": {
    "drums": "[https://tonejs.github.io/.../kick.mp3](https://tonejs.github.io/.../kick.mp3)",
    "bass": "...",
    ...
  }
}
```