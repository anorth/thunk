export default class InstallationId {
  public static get() {
    return singletonPromise;
  }
}

const singletonPromise = new Promise((resolve) => {
  chrome.storage.local.get("installationId", got => {
    let installationId;
    if (!got.installationId) {
      const chars = [];
      for (let i = 0; i < 20; i++) {
        chars.push(65 + Math.floor(Math.random() * 26));
      }
      installationId = String.fromCharCode.apply(String, chars);
      console.log("New installation id " + installationId);
      chrome.storage.local.set({installationId});
    } else {
      installationId = got.installationId;
      console.log("Installation id " + installationId);
    }
    resolve(installationId);
  });
});
