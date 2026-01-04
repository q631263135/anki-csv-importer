// 内容脚本 - 用于从网页中提取CSV数据
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractCSV') {
    const csvText = extractCSVFromPage();
    sendResponse({ csv: csvText });
  }
});

function extractCSVFromPage() {
  // 尝试从页面中提取CSV数据
  const preElements = document.querySelectorAll('pre');
  for (const pre of preElements) {
    const text = pre.textContent;
    if (looksLikeCSV(text)) {
      return text;
    }
  }

  // 尝试从textarea提取
  const textareas = document.querySelectorAll('textarea');
  for (const textarea of textareas) {
    const text = textarea.value;
    if (looksLikeCSV(text)) {
      return text;
    }
  }

  return null;
}

function looksLikeCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;
  
  const firstLine = lines[0];
  return firstLine.includes(',') || firstLine.includes('\t') || firstLine.includes(';');
}
