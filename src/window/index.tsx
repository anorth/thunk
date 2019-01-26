import * as React from "react";
import {App} from "../app/app";
import {INTEGRATION_SINGLETON} from "../backend/Integrations";
import {ChromePlatform} from "../chrome/chromeplatform";

function main() {
  const app = new App(new ChromePlatform(), INTEGRATION_SINGLETON);
  app.run(document.getElementById("app"));
}

main();
