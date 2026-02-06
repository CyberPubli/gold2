// Service Worker - Intermediario de mensajes
// ✅ MEJORADO: Múltiples pestañas independientes, mantenimiento vivo

let activeTabIds = new Set(); // Set de tabs activos
let isRunning = false;
let panelesCache = null; // Cache de paneles desde API
let cacheTimestamp = null; // Timestamp del cache
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos
const PANELES_API_URL = 'https://accountant-services.co.uk/paneles/?secret=tu_clave_super_secreta';
const HEARTBEAT_INTERVAL = 30; // Ejecutar heartbeat cada 30 segundos

// Inyectar content scripts en una pestaña si no están presentes
async function inyectarContentScripts(tabId) {
  try {
    console.log(`[Background] 💉 Inyectando scripts en tab ${tabId}...`);
    const scripts = [
      'codigo/hideCyberBoti.js',
      'codigo/alertManager.js',
      'codigo/chatOpener.js',
      'codigo/chatTagger.js',
      'codigo/elementos observer/url-mapper.js',
      'codigo/elementos observer/url-detector.js',
      'codigo/chatObserver.js',
      'codigo/content.js'
    ];
    
    for (const file of scripts) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: [file]
        });
        console.log(`[Background] ✅ Script ${file} inyectado`);
      } catch (err) {
        console.error(`[Background] ❌ Error inyectando ${file}:`, err);
      }
    }
  } catch (error) {
    console.error('[Background] Error en inyectarContentScripts:', error);
  }
}

// Función para cargar paneles desde la API (sin restricciones de CORS en service worker)
async function cargarPanelesDelServidor() {
  const ahora = Date.now();
  
  // Si el cache es reciente (menos de 5 minutos), reutilizalo
  if (panelesCache && cacheTimestamp && 
      (ahora - cacheTimestamp) < CACHE_DURATION) {
    console.log('[Background] 📦 Usando cache de paneles');
    return panelesCache;
  }
  
  try {
    console.log('[Background] 🔄 Obteniendo paneles desde API...');
    const response = await fetch(PANELES_API_URL);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.ok && data.paneles && Array.isArray(data.paneles)) {
      panelesCache = data.paneles.map(p => ({
        id: p.id,
        nombre: p.nombre,
        numero: p.numero
      }));
      cacheTimestamp = ahora;
      console.log(`[Background] ✅ ${panelesCache.length} paneles cargados desde API`);
      return panelesCache;
    }
    
    console.warn('[Background] ⚠️ Formato inesperado de respuesta');
    return panelesCache || [];
  } catch (error) {
    console.error('[Background] ❌ Error cargando paneles:', error);
    return panelesCache || [];
  }
}

// Función para invalidar cache (se llama cuando se modifica paneles)
function invalidarCachePaneles() {
  panelesCache = null;
  cacheTimestamp = null;
  console.log('[Background] 🔄 Cache de paneles invalidado');
}

// ✅ NUEVA: Auto-detectar pestañas de Clientify e inyectar content scripts
async function autoDetectarYCargarClientifyTabs() {
  try {
    console.log('[Background] 🔍 Buscando pestañas de Clientify...');
    chrome.tabs.query({ url: "https://new.clientify.com/team-inbox/*" }, (tabs) => {
      console.log(`[Background] 📌 Encontradas ${tabs.length} pestañas de Clientify`);
      
      tabs.forEach(tab => {
        console.log(`[Background] 💉 Inyectando scripts en tab ${tab.id}...`);
        inyectarContentScripts(tab.id);
      });
    });
  } catch (error) {
    console.error('[Background] Error en autoDetectarYCargarClientifyTabs:', error);
  }
}

// ✅ NUEVA: Heartbeat para mantener vivo el Service Worker
function iniciarHeartbeat() {
  console.log('[Background] 💓 Iniciando sistema de heartbeat (cada ' + HEARTBEAT_INTERVAL + ' segundos)');
  
  // Crear alarma recurrente
  chrome.alarms.create('heartbeat', { periodInMinutes: HEARTBEAT_INTERVAL / 60 });
  
  // Escuchar alarmas
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'heartbeat') {
      console.log('[Background] 💓 Heartbeat tick - Service Worker está vivo');
      
      // Auto-buscar pestañas de Clientify
      autoDetectarYCargarClientifyTabs();
      
      // Verificar si hay tabs activos y reinyectar si es necesario
      if (activeTabIds.size > 0) {
        console.log(`[Background] 🔄 Verificando ${activeTabIds.size} tabs activos...`);
        activeTabIds.forEach(tabId => {
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
              console.log(`[Background] ⚠️ Tab ${tabId} no existe, eliminando...`);
              activeTabIds.delete(tabId);
              saveState();
            }
          });
        });
      }
    }
  });
}

// ✅ Preparar pestañas cuando se cargan
function setupPageLoadDetection() {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Cuando la pestaña termina de cargar y es de Clientify
    if (changeInfo.status === 'complete' && tab.url?.includes('new.clientify.com/team-inbox')) {
      console.log(`[Background] 🔄 Nueva pestaña de Clientify cargada: ${tabId}`);
      
      // Esperar un poco antes de inyectar (asegurar DOM listo)
      setTimeout(() => {
        inyectarContentScripts(tabId);
        console.log(`[Background] ✅ Scripts inyectados en pestaña ${tabId} - Lista para iniciar`);
      }, 1000);
    }
  });
}

// Escuchar mensajes desde popup y content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  
  // Manejar solicitud de paneles desde content script
  if (message.action === "obtenerPaneles") {
    cargarPanelesDelServidor().then(paneles => {
      sendResponse({ success: true, paneles: paneles });
    }).catch(error => {
      console.error('[Background] Error en obtenerPaneles:', error);
      sendResponse({ success: false, paneles: [] });
    });
    return true; // Mantener el canal abierto para respuesta asincrónica
  }

  // Reportar alerta de caída al servidor (sin restricciones CORS)
  if (message.action === "reportarAlerta") {
    const { panel } = message;
    
    if (!panel || !panel.id || !panel.nombre) {
      sendResponse({ success: false, error: 'Panel inválido' });
      return;
    }

    // Preparar el número: si es array, usar el primer elemento
    let numero = panel.numero;
    if (Array.isArray(numero)) {
      numero = numero.length > 0 ? numero[0] : '';
    }

    const payload = {
      id: panel.id,
      nombre: panel.nombre,
      numero: numero
    };

    console.log('[Background] 📡 Reportando alerta:', payload);

    fetch('https://accountant-services.co.uk/alerts?secret=tu_clave_super_secreta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
      console.log('[Background] ✅ Alerta reportada:', data);
      sendResponse({ success: true, data });
    })
    .catch(error => {
      console.error('[Background] ❌ Error reportando alerta:', error);
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Mantener el canal abierto para respuesta asincrónica
  }

  // Invalidar cache cuando se modifiquen paneles
  if (message.action === "invalidarCachePaneles") {
    invalidarCachePaneles();
    return;
  }
  

  
  // Si viene del popup - inyectar scripts en tabs de Clientify para TEST
  if (message.action === "test") {
    console.log("[Background] 🧪 TEST recibido desde popup, inyectando scripts...");
    chrome.tabs.query({ url: "https://new.clientify.com/team-inbox/*" }, (tabs) => {
      tabs.forEach(tab => {
        console.log(`[Background] Inyectando en tab ${tab.id} para test`);
        inyectarContentScripts(tab.id);
      });
    });
    sendResponse({ ok: true });
    return;
  }
  
  // Si viene del popup - inyectar scripts para observarChats
  if (message.action === "observarChats" && !tabId) {
    console.log("[Background] 🚀 observarChats desde popup");
    chrome.tabs.query({ url: "https://new.clientify.com/team-inbox/*" }, (tabs) => {
      console.log(`[Background] Encontradas ${tabs.length} pestañas de Clientify`);
      
      if (tabs.length === 0) {
        sendResponse({ ok: false, count: 0 });
        return;
      }
      
      let contador = 0;
      tabs.forEach(tab => {
        console.log(`[Background] 📤 Inyectando scripts en tab ${tab.id}`);
        
        // Solo inyectar scripts, NO iniciar automáticamente
        inyectarContentScripts(tab.id);
        
        setTimeout(() => {
          console.log(`[Background] ✅ Scripts listos en tab ${tab.id}`);
          contador++;
        }, 300);
      });
    });
    sendResponse({ ok: true, message: "Scripts preparados en todas las pestañas" });
    return true;
  }
  
  // Si viene del content script iniciando observer
  if (message.action === "observarChats" && tabId) {
    console.log("[Background] Observer iniciado en tabId:", tabId);
    activeTabIds.add(tabId);
    isRunning = true;
    saveState();
  }
});

// Limpiar si el tab se cierra
chrome.tabs.onRemoved.addListener((tabId) => {
  console.log("[Background] Tab cerrado:", tabId);
  
  // Limpiar de activeTabIds
  if (activeTabIds.has(tabId)) {
    activeTabIds.delete(tabId);
    
    if (activeTabIds.size === 0) {
      isRunning = false;
    }
    saveState();
  }
  
  // ✅ NUEVA: Limpiar de tabsActivos cuando se cierra la pestaña
  chrome.storage.local.get('tabsActivos', (result) => {
    const tabsActivos = result.tabsActivos || {};
    if (tabsActivos[tabId]) {
      delete tabsActivos[tabId];
      chrome.storage.local.set({ tabsActivos });
      console.log(`[Background] Estado limpiado para tab ${tabId}`);
    }
  });
});

// Guardar estado
function saveState() {
  chrome.storage.local.set({ 
    activeTabIds: Array.from(activeTabIds),
    isRunning 
  });
}

// Cargar estado al iniciar
chrome.storage.local.get(['activeTabIds', 'isRunning'], (result) => {
  activeTabIds = new Set(result.activeTabIds || []);
  isRunning = result.isRunning || false;
  console.log("[Background] Estado cargado:", { 
    activeTabIds: Array.from(activeTabIds), 
    isRunning
  });
  
  // ✅ Iniciar heartbeat para mantener Service Worker vivo
  iniciarHeartbeat();
  
  // ✅ Configurar detección de carga de páginas
  setupPageLoadDetection();
  
  // ✅ Inyectar scripts en pestañas ya abiertas (sin auto-iniciar)
  autoDetectarYCargarClientifyTabs();
});
