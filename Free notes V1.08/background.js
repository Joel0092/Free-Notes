chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg === 'open_options_page') {
    chrome.runtime.openOptionsPage();
  }
});

// 扩展安装/升级后自动注入content.js和note.css到所有已打开标签页
chrome.runtime.onInstalled.addListener((details) => {
  // 如果是第一次安装，自动打开设置页面
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
  
  // 注入脚本到所有已打开的标签页
  chrome.tabs.query({}, function(tabs) {
    for (let tab of tabs) {
      if (
        tab.url &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('edge://') &&
        !tab.url.startsWith('about:')
      ) {
        chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['note.css']
        }, () => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
        });
      }
    }
  });
}); 