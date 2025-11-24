const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

const MUSIC_AI_KEY = process.env.MUSIC_AI_KEY;
const WORKFLOW_ID = process.env.WORKFLOW_ID; 
const BASE_URL = 'https://api.music.ai/api'; 

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
  
  // Normaliza chaves do objeto para minúsculas para facilitar a busca
  const normalizedObj = {};
  for (const key in obj) {
    normalizedObj[key.toLowerCase()] = obj[key];
  }

  for (const key of keysToFind) {
    const k = key.toLowerCase();
    if (normalizedObj[k]) return normalizedObj[k];
  }
  
  // Busca profunda se necessário
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
    
    if (!MUSIC_AI_KEY) return sendDemo(res, "Falta chave API");

    // 1. URL
    let uploadData;
    try {
      const getUrlRes = await axios.get(`${BASE_URL}/upload`, { headers: { 'Authorization': MUSIC_AI_KEY } });
      uploadData = getUrlRes.data;
    } catch (e) {
      fs.unlinkSync(req.file.path);
      return sendDemo(res, "Erro conexão Music.ai");
    }

    const putUrl = uploadData.uploadUrl || uploadData.url;
    const downloadUrl = uploadData.downloadUrl;

    // 2. UPLOAD
    console.log("📤 Enviando...");
    const fileBuffer = fs.readFileSync(req.file.path);
    await axios.put(putUrl, fileBuffer, {
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': req.file.size }
    });

    // 3. JOB
    console.log(`🧠 Iniciando Workflow...`);
    const jobRes = await axios.post(`${BASE_URL}/job`, {
      name: `synesthesia-${Date.now()}`,
      workflow: WORKFLOW_ID, 
      params: { inputUrl: downloadUrl }
    }, { headers: { 'Authorization': MUSIC_AI_KEY } });

    const jobId = jobRes.data.id;
    console.log(`⏳ Job ID: ${jobId}`);

    // 4. POLLING
    let fullResponse = null;
    for (let i = 0; i < 100; i++) { 
      await sleep(2000);
      const checkRes = await axios.get(`${BASE_URL}/job/${jobId}`, { headers: { 'Authorization': MUSIC_AI_KEY } });
      const status = checkRes.data.status ? checkRes.data.status.toUpperCase() : 'UNKNOWN';
      process.stdout.write(".");
      
      if (status === 'SUCCEEDED' || status === 'COMPLETED' || status === 'SUCCESS') {
        fullResponse = checkRes.data;
        break;
      } else if (status === 'FAILED') {
        console.log("\n❌ Falhou.");
        fs.unlinkSync(req.file.path);
        return sendDemo(res, "Falha na IA");
      }
    }

    if (!fullResponse) throw new Error("Timeout");

    console.log("\n✅ Concluído!");
    fs.unlinkSync(req.file.path);

    // 5. EXTRAÇÃO ROBUSA
    const result = fullResponse?.result || {};
    console.log("📦 Resposta Bruta:", JSON.stringify(result, null, 2));
    
    // LISTAS DE SINÔNIMOS ATUALIZADAS
    const drumsUrl = findValueByKey(result, ['bateria', 'drums', 'drum']);
    const bassUrl = findValueByKey(result, ['baixo', 'bass']);
    const vocalsUrl = findValueByKey(result, ['voz', 'vozes', 'vocals', 'vocal', 'voice']); // Adicionado "voz"
    
    // Tenta achar outros instrumentos ou usa "outros" como coringa
    const otherUrl = findValueByKey(result, ['outros', 'outro', 'other', 'others', 'accompaniment']);
    const guitarUrl = findValueByKey(result, ['guitarra', 'guitar', 'guitarras']) || otherUrl;
    const pianoUrl = findValueByKey(result, ['piano', 'keys', 'teclado']) || otherUrl;

    if (!drumsUrl && !bassUrl) return sendDemo(res, "Links vazios");

    // Retorna o objeto final
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
    console.error("\n❌ Erro:", error.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return sendDemo(res, "Erro interno");
  }
});

app.listen(3001, () => {
  console.log('🚀 SERVIDOR CORRIGIDO RODANDO (3001)');
});