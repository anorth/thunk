import * as React from "react";
import * as ReactDOM from "react-dom";
import {Integration} from "../backend/Integration";

import {EngineProxy, Message} from "../background/engineproxy";
import {ChromePlatform} from "../chrome/chromeplatform";
import GDrive from "../integrations/gdrive";
import * as Messages from "../messaging/messages";

import "./app.scss";
import {RootComponent, RootVM} from "./components/root";

export class App {
  private readonly platform: ChromePlatform;
  private readonly i9n: Integration<any>;

  private running: boolean;

  constructor(platform: ChromePlatform, integration: GDrive) {
    this.platform = platform;
    this.i9n = integration;
    this.running = false;
  }

  public run(container: HTMLElement) {
    if (this.running) {
      throw new Error("Already running");
    }
    this.running = true;
    pingBackgroundPage(this.platform);

    this.platform.browserActionShortcut().then(shortcut => {
      const instances = this.i9n.instances();
      const preferredInstance = this.i9n.getPreferredInstance(instances);
      console.debug("Using preferred instance:", preferredInstance);

      const viewModel = new RootVM(instances, preferredInstance, shortcut);
      render(this.platform, container, this.i9n, viewModel);
      // Return null to signal that we didn't forget to return.
      // http://bluebirdjs.com/docs/warning-explanations.html#warning-a-promise-was-created-in-a-handler-but-was-not-returned-from-it
      return null;
    }).done();
  }
}

function render(platform: ChromePlatform, container: HTMLElement, integration: Integration<any>, viewModel: RootVM) {
  const proxy = new EngineProxy(platform);
  return ReactDOM.render(
      <RootComponent platform={platform} engine={proxy} integration={integration} vm={viewModel}/>,
      container
  );
}

function pingBackgroundPage(platform: ChromePlatform) {
  let port = platform.connectPort("test");
  port.sendMessage(Messages.pingPong("hello"));
  const handle = port.addMessageReceiver(onMessage);

  function onMessage(msg: Message) {
    console.debug("Pong received", msg);
    port.removeMessageReceiver(handle);
    port.close();
    port = null;
  }
}
