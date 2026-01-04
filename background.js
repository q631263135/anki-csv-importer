// 后台脚本
chrome.runtime.onInstalled.addListener(() => {
  console.log('Anki CSV Importer installed');
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'importToAnki') {
    // 处理导入逻辑
    handleImport(request.data)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开放
  }
});

async function handleImport(data) {
  // 实现导入逻辑
  return { imported: data.notes.length };
}
