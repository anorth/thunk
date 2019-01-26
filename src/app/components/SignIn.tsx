import {observable} from "mobx";
import {observer} from "mobx-react";
import * as React from "react";
import {ChangeEvent, FormEvent} from "react";
import urlparse from "urlparse";
import {Integration} from "../../backend/Integration";
import {ChromePlatform} from "../../chrome/chromeplatform";
import * as Messages from "../../messaging/messages";
import {InstanceSpec} from "../../model/InstanceSpec";

import "./SignIn.scss";

/** Sign-in component view-model */
export class SignInVM {
  public readonly instances: InstanceSpec[];
  public readonly preferredInstance: InstanceSpec;

  @observable
  public selectedInstance: InstanceSpec | null;  // InstanceSpec from form select element
  @observable
  public otherInstance: string | null; // From form input text element

  constructor(instances: InstanceSpec[], preferredInstance: InstanceSpec) {
    this.instances = instances;
    this.preferredInstance = preferredInstance;

    if (preferredInstance) {
      this.instanceSelect(preferredInstance);
    } else if (instances.length > 0) {
      this.instanceSelect(instances[0]);
    }
  }

  public instanceSelect(instance: InstanceSpec) {
    this.selectedInstance = instance;
  }

  public instanceType(otherInstance: string) {
    this.selectedInstance = null;
    this.otherInstance = otherInstance;
  }
}

export interface SignInProps {
  platform: ChromePlatform;
  integration: Integration<any>;
  vm: SignInVM;

  authFetching: boolean;
  authError: string | null;

  onAuthBegin: () => void;
  onAuthErrorCleared: () => void;
}

const KEY_OTHERINSTANCE = "signin-otherinstance";

@observer
export class SignInComponent extends React.Component<SignInProps> {
  private readonly platform: ChromePlatform;
  private readonly integration: Integration<any>;

  constructor(props: SignInProps) {
    super(props);
    this.platform = props.platform;
    this.integration = props.integration;
  }

  public componentWillMount() {
    const savedOtherInstance = localStorage.getItem(KEY_OTHERINSTANCE);
    if (!!savedOtherInstance) {
      this.props.vm.instanceType(savedOtherInstance);
    }
  }

  public render() {
    const self = this;
    const {authFetching, authError} = this.props;
    const {instances, selectedInstance, otherInstance} = this.props.vm;

    return <div id="SignIn">
      <div className="landing">
        <h1>Sign in to {self.integration.displayName}</h1>
        <p>
          Sign in to {self.integration.displayName} now for fast and easy search in your browser.
        </p>
        <p>
          <strong>It's secure: none of your content will leave your computer.</strong>
        </p>
        <p>
          All the magic happens in your browser. We don't collect any information.
        </p>
        <form onSubmit={self.logIn.bind(self)}>
          {renderDomainSelector()}
          {renderButton()}
        </form>
      </div>
    </div>;

    function renderDomainSelector() {
      const otherSelected = !selectedInstance;
      if (self.integration.sniffsCookies) {
        if (instances.length > 0) {
          return <div className="field-group">
            <label htmlFor="domain">Select your {self.integration.displayName}:</label>
            <select id="domain" name="domain" autoFocus={!otherSelected}
                    onChange={onSelectChange}
                    value={!!selectedInstance ? selectedInstance.id : ""}>
              {instances.map(instance => <option value={instance.id} key={instance.id}>{instance.id}</option>)}
              <option key="separator" disabled={true}>—————————————</option>
              <option value="" key="other">Other...</option>
            </select>
            {otherSelected ? renderOtherInput() : null}
          </div>;
        } else {
          return <div className="field-group">
            <label htmlFor="otherInstance">Enter your {self.integration.displayName}'s URL:</label>
            {renderOtherInput()}
          </div>;
        }
      }
    }

    function renderOtherInput() {
      return <div>
        <input type="text" name="otherInstance" autoFocus={true}
               onChange={onOtherInputChange}
               value={otherInstance}
               placeholder={"e.g. https://" + self.integration.exampleInstance.id}
        />
      </div>;
    }

    function renderButton() {
      const err = authError ?
          <div className="error">Sign in failed: {authError}</div> : null;
      return <div>
        {err}
        <input type="submit"
               value={"Sign in to " + self.integration.displayName}
               disabled={authFetching || !self.isAuthDataValid()}/>
        {authFetching ? <div className="spinner"/> : null}
      </div>;
    }

    function onSelectChange(e: ChangeEvent<HTMLSelectElement>) {
      const instance = !!e.target.value ? InstanceSpec.fromId(e.target.value) : null;
      self.props.onAuthErrorCleared();
      self.props.vm.instanceSelect(instance);
      // TODO: fix flicker, possibly with animation.
    }

    function onOtherInputChange(e: ChangeEvent<HTMLInputElement>) {
      self.props.onAuthErrorCleared();
      self.props.vm.instanceType(e.target.value);
    }
  }

  private logIn(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    const authData = this.getAuthData();

    if (!this.props.vm.selectedInstance) {
      localStorage.setItem(KEY_OTHERINSTANCE, this.props.vm.otherInstance);
    } else {
      localStorage.removeItem(KEY_OTHERINSTANCE);
    }

    // The background page does the sign in.
    // On gdrive, do not expect a response: the pop up will be torn down immediately.
    this.platform.sendMessage(Messages.signInRequested(authData));
    this.props.onAuthBegin();
  }

  /**
   * Returns true iff the form auth data passes basic validation.
   * (Does not guarantee auth will pass.)
   */
  private isAuthDataValid(): boolean {
    return !this.integration.sniffsCookies || !!this.getAuthData();
  }

  /** Determines the auth data based on the form state. */
  private getAuthData(): any | null {
    const instance = this.props.vm.selectedInstance || this._parseInstance(this.props.vm.otherInstance);
    return !!instance ? instance.toJS() : null;
  }

  /** Parses the instance provided by the user, e.g. https://cwiki.apache.org/confluence */
  // Consider pushing this down into integration classes.
  private _parseInstance(instanceText: string): InstanceSpec | null {
    const parsed = urlparse(instanceText);
    try {
      parsed.validate();
    } catch (e) {
      return null;
    }
    if (!parsed.authority) {
      return null;
    }
    parsed.path = parsed.path || "/";
    // Do we need to parse 'scheme' as well, i.e. for localhost Atlassian instances?
    return new InstanceSpec(
        parsed.authority,  // authority == domain + port
        parsed.path
    );
  }
}
