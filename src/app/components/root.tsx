import {observable} from "mobx";
import {observer} from "mobx-react";
import * as React from "react";
import {Integration} from "../../backend/Integration";
import {EngineProxy} from "../../background/engineproxy";
import {ChromePlatform, Handle} from "../../chrome/chromeplatform";
import * as Messages from "../../messaging/messages";
import {InstanceSpec} from "../../model/InstanceSpec";
import {ListingComponent, ListingVM} from "./Listing";
import "./Root.scss";
import {SignInComponent, SignInVM} from "./SignIn";

/** The "view model" for the root view component. */
export class RootVM {
  // The keyboard shortcut to trigger the extension's browser action.
  public readonly browserActionShortcut: string;

  @observable
  public authFetching: boolean;
  @observable
  public authError: string | null;
  @observable
  public authenticated: boolean | null; // tri-state

  @observable
  public tab: string;

  @observable
  public signInVM: SignInVM;
  @observable
  public listingVM: ListingVM;

  constructor(instances: InstanceSpec[], preferredInstance: InstanceSpec, browserActionShortcut: string) {
    this.browserActionShortcut = browserActionShortcut;
    this.authFetching = false;
    this.authError = null;
    this.authenticated = null;
    this.tab = "listing";

    this.signInVM = new SignInVM(instances, preferredInstance);
    this.listingVM = new ListingVM();
  }

  public authCheckBegin() {
    this.authenticated = null;
    this.authFetching = true;
  }

  public authCheckComplete(authed: boolean, error: string) {
    this.authenticated = authed;
    this.authFetching = false;
    this.authError = error;
    if (!authed) {
      this.listingVM.clearResults();
    }
  }

  public authErrorClear() {
    this.authError = null;
  }

  public tabChanged(tab: string) {
    this.tab = tab;
  }
}

interface RootProps {
  platform: ChromePlatform;
  engine: EngineProxy;
  integration: Integration<any>;
  vm: RootVM;
}

@observer
export class RootComponent extends React.Component<RootProps> {
  private readonly platform: ChromePlatform;
  private readonly i9n: Integration<any>;
  private receiver: Handle;

  constructor(props: RootProps) {
    super(props);
    this.platform = props.platform;
    this.i9n = props.integration;
    this.receiver = null;
  }

  public componentDidMount() {
    this.checkAuth();

    this.receiver = this.platform.addMessageReceiver((msg/*, sender, sendResponse*/) => {
      const payload = msg.payload;
      console.log("Root received " + msg.type, payload);
      switch (msg.type) {
        case Messages.SIGNED_IN:
          this.props.vm.authCheckComplete(true, null);
          // The 'integration' object exists in each of background and window's scopes.
          // background.js's copy of integration is accurate; force the local (window) copy too:
          this.i9n.checkAuthentication().done();
          break;
        case Messages.SIGN_IN_FAILED:
          this.props.vm.authCheckComplete(false, payload.authError);
          break;
      }
    });
  }

  public componentWillUnmount() {
    this.platform.removeMessageReceiver(this.receiver);
  }

  public render() {
    const vm = this.props.vm;
    const self = this;
    let content;
    if (vm.authenticated !== false) { // Optimistically show content until auth check fails
      // tab === "listing"
      content = <ListingComponent platform={this.platform}
                                  engine={this.props.engine}
                                  integration={this.i9n}
                                  vm={vm.listingVM}/>;
    } else {
      content = <SignInComponent platform={this.platform} integration={this.i9n} vm={vm.signInVM} {...vm}
                                 onAuthBegin={vm.authCheckBegin}
                                 onAuthErrorCleared={vm.authErrorClear}
      />;
    }
    return <div id="Root">
      <div className="header"/>
      <div className="content">
        {content}
      </div>
      <div className="footer">
        {renderFooter()}
      </div>
    </div>;

    function renderFooter() {
      const signOutLink = <a href="#" onClick={self.logOut.bind(self)}>
        Sign out of {self.i9n.displayName}
      </a>;
      if (vm.authenticated) {
        // TODO: handle modifiers like cmd-click on the anchor
        const tip =  vm.browserActionShortcut ?
            <div className="tip">Tip: Open {self.platform.extensionShortName} quickly by pressing {vm.browserActionShortcut}</div> :
            <div className="tip">Tip: Quickly select a result using your &uarr;/&darr; and &#9166; keys</div>;
        return <div>
          {tip}
          <div className="auth">
            <a className="to-drive" href={self.i9n.homeUrl}
               target="_blank">Go to {self.i9n.displayName}</a>
            &nbsp;•&nbsp;{signOutLink}
          </div>
          {/*<DevTools/>*/}
        </div>;
      } else if (vm.authenticated === null) { // Checking
        return <div className="auth">Checking credentials... &nbsp;•&nbsp;{signOutLink}</div>;
      }
    }
  }

  private checkAuth(): void {
    this.props.vm.authCheckBegin();
    this.i9n.checkAuthentication()
        .then(authenticated => {
          this.props.vm.authCheckComplete(authenticated, null);
          if (!authenticated) {
            // FIXME: signing out should send a request to the backend and perform the logic there rather than
            // have the backend rely on the UI indicating successful sign out.
            this.platform.sendMessage(Messages.signedOut());
          }
        })
        .done();
  }

  private logOut() {
    this.props.vm.authCheckBegin();
    this.i9n.unauthenticate().finally(() => {
      this.platform.sendMessage(Messages.signedOut());
      this.props.vm.authCheckComplete(false, null);
    });
  }
}
