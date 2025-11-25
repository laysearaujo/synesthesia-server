const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

// --- CONFIGURAÇÃO DE CORS ---
// Permite acesso de qualquer lugar (*) ou restrinja para seu domínio no futuro
app.use(cors({
  origin: '*', // Para protótipos e hackathons, '*' é o mais seguro para evitar dor de cabeça
  methods: ['GET', 'POST']
}));

app.use(express.json());

// --- TRATAMENTO DE CHAVE (TRIM) ---
const MUSIC_AI_KEY = process.env.MUSIC_AI_KEY ? process.env.MUSIC_AI_KEY.trim() : "";
const WORKFLOW_ID = process.env.WORKFLOW_ID ? process.env.WORKFLOW_ID.trim() : "";
const BASE_URL = 'https://api.music.ai/v1'; 

// Health Check (Para testar se o servidor está vivo)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    hasKey: !!MUSIC_AI_KEY, 
    keyLength: MUSIC_AI_KEY.length, 
    workflow: WORKFLOW_ID 
  });
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

app.post('/separate', upload.single('audio'), async (req, res) => {
  try {
    console.log("\n🎵 RECEBENDO UPLOAD...");
    
    // Validação inicial
    if (!MUSIC_AI_KEY) return sendDemo(res, "Falta chave API no .env");
    if (MUSIC_AI_KEY.length < 10) return sendDemo(res, "Chave API parece inválida (muito curta)");

    console.log(`🔑 Chave carregada (${MUSIC_AI_KEY.length} chars). Iniciando...`);

    // 1. OBTER URL DE UPLOAD
    let uploadData;
    try {
      const getUrlRes = await axios.get(`${BASE_URL}/upload`, { 
        headers: { 'Authorization': MUSIC_AI_KEY } 
      });
      uploadData = getUrlRes.data;
    } catch (e) {
      console.error("❌ Erro Auth/Conexão:", e.response?.data || e.message);
      if (req.file) fs.unlinkSync(req.file.path);
      return sendDemo(res, "Erro de Autenticação na Music.ai (Verifique o .env)");
    }

    const putUrl = uploadData.uploadUrl || uploadData.url;
    const downloadUrl = uploadData.downloadUrl;

    // 2. UPLOAD DO ARQUIVO
    console.log("📤 Enviando arquivo...");
    const fileBuffer = fs.readFileSync(req.file.path);
    await axios.put(putUrl, fileBuffer, {
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': req.file.size }
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

    // 4. POLLING
    let fullResponse = null;
    for (let i = 0; i < 60; i++) { 
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
        fs.unlinkSync(req.file.path);
        return sendDemo(res, "Falha no Job");
      }
    }

    if (!fullResponse) throw new Error("Timeout");

    console.log("\n✅ Concluído!");
    fs.unlinkSync(req.file.path);

    // 5. EXTRAIR LINKS
    const result = fullResponse?.result || {};
    console.log("📦 Resultado:", JSON.stringify(result, null, 2));
    
    const drumsUrl = findValueByKey(result, ['bateria', 'drums', 'drum']);
    const bassUrl = findValueByKey(result, ['baixo', 'bass']);
    const vocalsUrl = findValueByKey(result, ['voz', 'vozes', 'vocals', 'vocal']);
    const otherUrl = findValueByKey(result, ['outros', 'outro', 'other', 'others', 'accompaniment']);
    
    const guitarUrl = findValueByKey(result, ['guitarra', 'guitar']) || otherUrl;
    const pianoUrl = findValueByKey(result, ['piano', 'keys', 'teclado']) || otherUrl;

    if (!drumsUrl && !bassUrl && !vocalsUrl) {
      return sendDemo(res, "Nenhum link encontrado");
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
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return sendDemo(res, "Erro interno");
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 SERVIDOR V1 PRONTO (Porta ${PORT})`);
});