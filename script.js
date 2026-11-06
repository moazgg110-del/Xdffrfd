'use strict';

// الاتصال المباشر بـ Gemini من المتصفح. المفتاح ظاهر داخل ملفات اللعبة كما طلب المستخدم.
const DEFAULT_API_KEY = 'AQ.Ab8RN6Ko6xZN-bL3fi5z3BEj2tp6AO3yTSidKUUA7bNX-SOkHw';
const API_KEY = localStorage.getItem('user_gemini_api_key_v2') || DEFAULT_API_KEY;
const STORY_MODEL = 'gemini-3.8-flash';
const IMAGE_MODEL = 'gemini-3.1-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

const $ = (id) => document.getElementById(id);
const storyBox = $('story-box');
const choicesContainer = $('choices-container');
const customActionInput = $('custom-action');
const sendActionBtn = $('send-action-btn');
const sceneImage = $('scene-image');
const imageLoader = $('image-loader');
const statusPill = $('connection-status');
const toggleSettingsBtn = $('toggle-settings-btn');
const toggleAboutBtn = $('toggle-about-btn');
const settingsPanel = $('settings-panel');
const aboutPanel = $('about-panel');
const gamePanel = $('game-panel');
const closeSettingsBtn = $('close-settings-btn');
const closeAboutBtn = $('close-about-btn');
const apiKeyInput = $('api-key-input');
const saveApiBtn = $('save-api-btn');
const themeDarkBtn = $('theme-dark-btn');
const themeLightBtn = $('theme-light-btn');
const fontSmallBtn = $('font-small-btn');
const fontMediumBtn = $('font-medium-btn');
const fontLargeBtn = $('font-large-btn');

let chatHistory = [];
let isBusy = false;
let adventureStarted = false;

const systemPrompt = `أنت محرك ذكاء اصطناعي تفاعلي يقود لعبة مغامرة خيال علمي لا تنتهي.
اكتب بالعربية الفصحى السهلة والمشوقة، واجعل قرارات اللاعب تؤثر فعليًا في الأحداث والشخصيات والمخزون والمكان.
لا تنه المغامرة بسرعة، وحافظ على استمرارية تفاصيل القصة.
في نهاية كل رد اكتب بالضبط:
القصة: وصف الأحداث
المشهد: وصف بصري باللغة الإنجليزية يصلح لتوليد صورة سينمائية للمشهد الحالي
الخيار 1: اختيار واضح
الخيار 2: اختيار واضح
الخيار 3: اختيار واضح`;

apiKeyInput.value = API_KEY;

function setStatus(message, kind = 'idle') {
  if (!statusPill) return;
  statusPill.textContent = message;
  statusPill.className = `status-pill ${kind}`;
}

function setBusy(value) {
  isBusy = value;
  sendActionBtn.disabled = value;
  customActionInput.disabled = value;
  choicesContainer.querySelectorAll('button').forEach((button) => button.disabled = value);
  sendActionBtn.textContent = value ? 'جاري الإرسال...' : 'إرسال الإجراء';
}

function showPanel(panel) {
  [settingsPanel, aboutPanel].forEach((item) => item.classList.add('hidden'));
  gamePanel.classList.add('hidden');
  if (panel === 'game') gamePanel.classList.remove('hidden');
  else panel.classList.remove('hidden');
}

toggleSettingsBtn.addEventListener('click', () => showPanel('settings'));
toggleAboutBtn.addEventListener('click', () => showPanel('about'));
closeSettingsBtn.addEventListener('click', () => showPanel('game'));
closeAboutBtn.addEventListener('click', () => showPanel('game'));

saveApiBtn.addEventListener('click', () => {
  const value = apiKeyInput.value.trim();
  if (!value) {
    appendStoryText('اكتب مفتاح API صالحًا أولًا.', 'error-msg');
    return;
  }
  localStorage.setItem('user_gemini_api_key_v2', value);
  location.reload();
});

themeDarkBtn.addEventListener('click', () => {
  document.body.classList.remove('light-mode');
  themeDarkBtn.classList.add('active');
  themeLightBtn.classList.remove('active');
  localStorage.setItem('space_theme', 'dark');
});
themeLightBtn.addEventListener('click', () => {
  document.body.classList.add('light-mode');
  themeLightBtn.classList.add('active');
  themeDarkBtn.classList.remove('active');
  localStorage.setItem('space_theme', 'light');
});
if (localStorage.getItem('space_theme') === 'light') themeLightBtn.click();

fontSmallBtn.addEventListener('click', () => setFontSize('0.94rem', fontSmallBtn));
fontMediumBtn.addEventListener('click', () => setFontSize('1.05rem', fontMediumBtn));
fontLargeBtn.addEventListener('click', () => setFontSize('1.18rem', fontLargeBtn));
function setFontSize(size, activeButton) {
  document.documentElement.style.setProperty('--font-size', size);
  [fontSmallBtn, fontMediumBtn, fontLargeBtn].forEach((button) => button.classList.remove('active'));
  activeButton.classList.add('active');
}

sendActionBtn.addEventListener('click', submitCustomAction);
customActionInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitCustomAction();
});
function submitCustomAction() {
  const action = customActionInput.value.trim();
  if (!action || isBusy) return;
  customActionInput.value = '';
  progressStory(action);
}

function appendStoryText(text, className = 'story-paragraph') {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  storyBox.appendChild(paragraph);
  storyBox.scrollTop = storyBox.scrollHeight;
}

function friendlyApiError(status, message) {
  if (status === 400) return `الطلب غير مقبول من Gemini: ${message}`;
  if (status === 401 || status === 403) return 'مفتاح API غير صالح أو لا يملك صلاحية استخدام Gemini. راجع المفتاح وإعداداته.';
  if (status === 404) return 'اسم النموذج غير متاح لهذا المفتاح أو في هذا الإصدار من API.';
  if (status === 429) return 'تم بلوغ حد الاستخدام مؤقتًا. انتظر قليلًا ثم حاول مرة أخرى.';
  if (status === 503 || status === 502 || status === 504) return 'خدمة Gemini مشغولة حاليًا. ستتم إعادة المحاولة تلقائيًا.';
  return message || `تعذر الاتصال بخدمة Gemini (HTTP ${status}).`;
}

async function fetchWithRetry(url, options, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      let response;
      try {
        response = await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (response.ok) return response;
      const data = await response.json().catch(() => ({}));
      const message = data?.error?.message || '';
      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === attempts - 1) {
        throw new Error(friendlyApiError(response.status, message));
      }
      lastError = new Error(friendlyApiError(response.status, message));
    } catch (error) {
      lastError = error.name === 'AbortError'
        ? new Error('انتهت مهلة الاتصال. تحقق من الإنترنت وحاول مرة أخرى.')
        : error;
      if (attempt === attempts - 1 || /مفتاح API|غير صالح|غير متاح|غير مقبول/.test(lastError.message)) throw lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  throw lastError || new Error('تعذر الاتصال بالخدمة.');
}

async function callGeminiStory(promptText) {
  chatHistory.push({ role: 'user', parts: [{ text: promptText }] });
  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: chatHistory,
    generationConfig: { temperature: 0.9, maxOutputTokens: 1800 }
  };
  const url = `${API_BASE}${STORY_MODEL}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n').trim();
  if (!text) throw new Error('وصل رد من Gemini لكنه لا يحتوي على نص للقصة.');
  chatHistory.push({ role: 'model', parts: [{ text }] });
  if (chatHistory.length > 24) chatHistory = chatHistory.slice(-24);
  return text;
}

async function generateGeminiImage(prompt) {
  imageLoader.classList.remove('hidden');
  sceneImage.classList.add('hidden');
  imageLoader.textContent = 'Gemini يرسم مشهد المغامرة الآن... 🎨';
  const imagePrompt = `Create a cinematic science-fiction adventure game scene, widescreen 16:9 composition, richly detailed environment, atmospheric lighting, no text, no captions, no logos. Scene: ${prompt}`;
  const url = `https://generativelanguage.googleapis.com/v1/models/${IMAGE_MODEL}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: imagePrompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], responseFormat: { image: { aspectRatio: '16:9', imageSize: '1K' } } }
  };
  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 2);
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part) => part.inlineData?.data && part.inlineData?.mimeType?.startsWith('image/'));
    if (!imagePart) throw new Error('لم يُرجع نموذج الصور ملف صورة. قد لا تكون ميزة الصور مفعّلة لهذا المفتاح.');
    sceneImage.onload = () => {
      imageLoader.classList.add('hidden');
      sceneImage.classList.remove('hidden');
    };
    sceneImage.onerror = () => {
      imageLoader.textContent = 'تعذر عرض الصورة الناتجة. جرّب تحديث المشهد.';
    };
    sceneImage.src = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  } catch (error) {
    imageLoader.textContent = `تعذر توليد الصورة: ${error.message}`;
    imageLoader.classList.remove('hidden');
    sceneImage.classList.add('hidden');
  }
}

function parseAndDisplayResponse(responseText) {
  const lines = responseText.split(/\r?\n/);
  const storyLines = [];
  const choices = [];
  let imagePrompt = '';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^المشهد\s*[:：]/.test(line)) imagePrompt = line.replace(/^المشهد\s*[:：]\s*/, '').trim();
    else if (/^الخيار\s*[123]\s*[:：]/.test(line)) choices.push(line.replace(/^الخيار\s*[123]\s*[:：]\s*/, '').trim());
    else if (/^القصة\s*[:：]/.test(line)) storyLines.push(line.replace(/^القصة\s*[:：]\s*/, '').trim());
    else if (line) storyLines.push(line);
  }
  appendStoryText(storyLines.join('\n') || responseText);
  if (!imagePrompt) imagePrompt = storyLines.join(' ').slice(0, 700) || 'A mysterious abandoned space station orbiting a distant blue planet';
  generateGeminiImage(imagePrompt);
  const cleanChoices = choices.filter(Boolean).slice(0, 3);
  displayChoices(cleanChoices.length ? cleanChoices : [
    'استكشف المكان القريب وابحث عن أي علامة للحياة.',
    'افحص لوحة التحكم وحاول تشغيل أنظمة المحطة.',
    'تقدم بحذر نحو مصدر الإشارة الغامضة.'
  ]);
}

function displayChoices(choices) {
  choicesContainer.replaceChildren();
  choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice-btn';
    button.textContent = `الخيار ${index + 1}: ${choice}`;
    button.addEventListener('click', () => progressStory(choice));
    choicesContainer.appendChild(button);
  });
}

async function startAdventure() {
  if (isBusy || adventureStarted) return;
  adventureStarted = true;
  storyBox.replaceChildren();
  choicesContainer.replaceChildren();
  setBusy(true);
  setStatus('يتصل بـ Gemini...', 'loading');
  try {
    const firstPrompt = 'ابدأ القصة من الصفر: يستيقظ البطل داخل كبسولة أمان في محطة فضائية مهجورة تدور حول كوكب مجهول. أضف لغزًا واضحًا وثلاثة اختيارات مؤثرة.';
    const result = await callGeminiStory(firstPrompt);
    parseAndDisplayResponse(result);
    setStatus('متصل – القصة تعمل', 'online');
  } catch (error) {
    adventureStarted = false;
    setStatus('تعذر الاتصال', 'error');
    appendStoryText(`تعذر بدء المغامرة: ${error.message}`, 'error-msg');
  } finally {
    setBusy(false);
  }
}

async function progressStory(actionText) {
  if (isBusy) return;
  appendStoryText(`إجراءك: ${actionText}`, 'user-action');
  setBusy(true);
  setStatus('Gemini يعالج اختيارك...', 'loading');
  try {
    const result = await callGeminiStory(`اختار اللاعب: ${actionText}. أكمل من آخر نقطة دون إعادة القصة، وبيّن نتيجة الاختيار ثم قدم تحديًا جديدًا وثلاثة اختيارات.`);
    parseAndDisplayResponse(result);
    setStatus('متصل – القصة تعمل', 'online');
  } catch (error) {
    setStatus('مشكلة في الاتصال', 'error');
    appendStoryText(`لم يتم تنفيذ الاختيار: ${error.message}`, 'error-msg');
  } finally {
    setBusy(false);
  }
}

// تبدأ اللعبة تلقائيًا عند فتح الصفحة.
window.addEventListener('DOMContentLoaded', startAdventure, { once: true });
