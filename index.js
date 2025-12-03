const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const YTDlpWrap = require('yt-dlp-wrap').default;
require('dotenv').config();

const app = express();
const ytDlpWrap = new YTDlpWrap(path.join(__dirname, 'yt-dlp'));

// Garante que a pasta uploads existe
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Configuração do Multer para uploads
const upload = multer({ dest: 'uploads/' });

// --- CONFIGURAÇÃO DE CORS ---
app.use(cors({
  origin: '*', // Permite conexões do seu frontend (localhost:5173 ou outro)
  methods: ['GET', 'POST']
}));

app.use(express.json());

// --- VARIÁVEIS DE AMBIENTE ---
const MUSIC_AI_KEY = process.env.MUSIC_AI_KEY ? process.env.MUSIC_AI_KEY.trim() : "";
const WORKFLOW_ID = process.env.WORKFLOW_ID ? process.env.WORKFLOW_ID.trim() : "";
const BASE_URL = 'https://api.music.ai/v1'; 

// --- FUNÇÕES AUXILIARES ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Stems de fallback para caso de erro ou falta de chave
const DEMO_STEMS = {
  drums: "https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3", 
  bass: "https://tonejs.github.io/audio/berklee/bass_loop.mp3",
  vocals: "https://tonejs.github.io/audio/berklee/gong_1.mp3",
  guitar: "https://tonejs.github.io/audio/berklee/guitar_loop.mp3",
  piano: "https://tonejs.github.io/audio/casio/A1.mp3"
};

const sendDemo = (res, motivo) => {
  console.log(`\n⚠️  ATIVANDO MODO DEMONSTRAÇÃO: ${motivo}`);
  res.json({ success: true, isDemo: true, stems: DEMO_STEMS });
};

// Função recursiva para encontrar URLs no JSON complexo da Music.ai
function findValueByKey(obj, keysToFind) {
  if (!obj || typeof obj !== 'object') return null;
  const normalizedObj = {};
  for (const key in obj) normalizedObj[key.toLowerCase()] = obj[key];
  for (const key of keysToFind) {
    const k = key.toLowerCase();
    if (normalizedObj[k]) return normalizedObj[k];
  }
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      const found = findValueByKey(obj[key], keysToFind);
      if (found) return found;
    }
  }
  return null;
}

// --- LÓGICA CENTRAL DA MUSIC.AI (REUTILIZÁVEL) ---
// Processa qualquer arquivo de áudio (seja do YouTube ou Upload)
async function processAudioFile(filePath, res) {
  try {
    // Validação da Chave
    if (!MUSIC_AI_KEY) return sendDemo(res, "Falta chave API no .env");
    if (MUSIC_AI_KEY.length < 10) return sendDemo(res, "Chave API inválida");

    console.log(`🔑 Iniciando processamento Music.ai para: ${filePath}`);

    // 1. OBTER URL DE UPLOAD
    let uploadData;
    try {
      const getUrlRes = await axios.get(`${BASE_URL}/upload`, { 
        headers: { 'Authorization': MUSIC_AI_KEY } 
      });
      uploadData = getUrlRes.data;
    } catch (e) {
      console.error("❌ Erro Auth/Conexão:", e.response?.data || e.message);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return sendDemo(res, "Erro Autenticação Music.ai");
    }

    const putUrl = uploadData.uploadUrl || uploadData.url;
    const downloadUrl = uploadData.downloadUrl;

    // 2. UPLOAD DO ARQUIVO PARA MUSIC.AI
    console.log("📤 Enviando arquivo para nuvem...");
    const fileBuffer = fs.readFileSync(filePath);
    await axios.put(putUrl, fileBuffer, {
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': fs.statSync(filePath).size }
    });

    // 3. CRIAR JOB
    console.log(`🧠 Criando job (Workflow: ${WORKFLOW_ID})...`);
    const jobRes = await axios.post(`${BASE_URL}/job`, {
      name: `synesthesia-${Date.now()}`,
      workflow: WORKFLOW_ID, 
      params: { inputUrl: downloadUrl }
    }, { 
      headers: { 'Authorization': MUSIC_AI_KEY } 
    });

    const jobId = jobRes.data.id;
    console.log(`⏳ Job ID: ${jobId}`);

    // 4. POLLING (ESPERAR RESPOSTA)
    let fullResponse = null;
    for (let i = 0; i < 90; i++) { // Tenta por 3 minutos (90 * 2s)
      await sleep(2000);
      const checkRes = await axios.get(`${BASE_URL}/job/${jobId}`, { 
        headers: { 'Authorization': MUSIC_AI_KEY } 
      });
      const status = (checkRes.data.status || 'UNKNOWN').toUpperCase();
      process.stdout.write(".");
      
      if (status === 'SUCCEEDED' || status === 'COMPLETED' || status === 'SUCCESS') {
        fullResponse = checkRes.data;
        break;
      } else if (status === 'FAILED') {
        console.log("\n❌ Falha no processamento da IA.");
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return sendDemo(res, "Falha no Job da IA");
      }
    }

    if (!fullResponse) throw new Error("Timeout: A IA demorou demais.");

    console.log("\n✅ Concluído!");
    // Limpa o arquivo local
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // 5. EXTRAIR LINKS DOS RESULTADOS
    const result = fullResponse?.result || {};
    
    // Procura flexível pelas chaves (bateria, drums, drum, etc)
    const drumsUrl = findValueByKey(result, ['bateria', 'drums', 'drum']);
    const bassUrl = findValueByKey(result, ['baixo', 'bass']);
    const vocalsUrl = findValueByKey(result, ['voz', 'vozes', 'vocals', 'vocal']);
    
    // Procura por 'other' (acompanhamento)
    const otherUrl = findValueByKey(result, ['outros', 'outro', 'other', 'others', 'accompaniment']);
    
    // Se não achar guitarra/piano específicos, usa o 'other'
    const guitarUrl = findValueByKey(result, ['guitarra', 'guitar']) || otherUrl;
    const pianoUrl = findValueByKey(result, ['piano', 'keys', 'teclado']) || otherUrl;

    // Se falhar tudo, manda demo
    if (!drumsUrl && !bassUrl && !vocalsUrl) {
      return sendDemo(res, "A IA não retornou links válidos");
    }

    res.json({
      success: true,
      stems: {
        drums: drumsUrl,
        bass: bassUrl,
        vocals: vocalsUrl,
        guitar: guitarUrl,
        piano: pianoUrl
      }
    });

  } catch (error) {
    console.error("\n❌ Erro Fatal:", error.message);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return sendDemo(res, "Erro interno no servidor");
  }
}

// --- ROTAS DA API ---

// 1. Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'Synesthesia V2', port: PORT });
});

// 2. Upload de Arquivo Local
app.post('/separate', upload.single('audio'), async (req, res) => {
  console.log("\n🎵 ROTA: Upload de Arquivo Local");
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });
  
  await processAudioFile(req.file.path, res);
});

// 3. Processar Link do YouTube (USANDO ARQUIVO FIXO cookie.txt)
app.post('/process-youtube', async (req, res) => {
  console.log("\n🎥 ROTA: YouTube Link");
  const { url } = req.body;
  
  if (!url) return res.status(400).json({ error: "URL não fornecida" });

  const outputName = `yt-${Date.now()}.mp3`;
  const outputPath = path.join('uploads', outputName);
  
  // NOME DO ARQUIVO: Certifique-se que subiu como 'cookies.txt' na raiz
  const cookiePath = path.join(__dirname, 'cookies.txt');

  try {
    if (!fs.existsSync('./yt-dlp')) {
        console.log("⬇️ Baixando binário yt-dlp...");
        await YTDlpWrap.downloadFromGithub();
    }

    console.log(`⏬ Baixando áudio do YouTube: ${url}`);

    // Verifica o arquivo
    if (fs.existsSync(cookiePath)) {
        console.log("🍪 Arquivo cookies.txt encontrado.");
    } else {
        console.log("⚠️ ARQUIVO DE COOKIES NÃO ENCONTRADO! O download vai falhar.");
    }

    const args = [
      url,
      '-x',             
      '--audio-format', 'mp3',
      '--audio-quality', '0', 
      '-o', outputPath, 
      '--no-check-certificates',
      '--prefer-free-formats',
      
      // 1. IDENTIDADE: Fingimos ser um PC (para combinar com o cookie do PC)
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
      
      // 2. TÁTICA ANTI-BOT: Pulamos o carregamento da página visual
      '--extractor-args', 'youtubetab:skip=webpage',
      '--extractor-args', 'youtube:player_skip=webpage,configs'
      
      // ❌ REMOVIDO: player_client=android (Isso estava causando o conflito!)
    ];

    // Injeta o cookie se existir
    if (fs.existsSync(cookiePath)) {
        args.push('--cookies', cookiePath);
    }
    
    // Executa
    await ytDlpWrap.execPromise(args);

    if (fs.existsSync(outputPath)) {
        return processAudioFile(outputPath, res);
    } else {
        throw new Error("O arquivo mp3 não foi criado.");
    }

  } catch (error) {
    console.error("Erro Fatal YouTube:", error.message);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    // Retorna erro amigável
    return sendDemo(res, "Erro: Bloqueio do YouTube (Tente renovar o cookies.txt)");
  }
});

// ========================================
// ATUALIZAÇÃO AUTOMÁTICA DO YT-DLP
// ========================================
const updateYtDlp = async () => {
  try {
    console.log("🔄 Atualizando yt-dlp...");
    await YTDlpWrap.downloadFromGithub('./yt-dlp', 'latest');
    console.log("✅ yt-dlp atualizado!");
  } catch (err) {
    console.log("⚠️  Erro ao atualizar:", err.message);
  }
};

// Atualiza ao iniciar o servidor
if (process.env.NODE_ENV === 'production') {
  updateYtDlp();
  // Atualiza a cada 24h
  setInterval(updateYtDlp, 24 * 60 * 60 * 1000);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`
  🚀 SERVIDOR RODANDO!
  -----------------------------------
  Porta:    ${PORT}
  Rotas:    POST /separate
            POST /process-youtube
  -----------------------------------
  `);
});