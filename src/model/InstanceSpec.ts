// Integration-dependent information about an instance of an integration.
// For example, a hosted or cloud installation of Confluence.
export class InstanceSpec {
  public static fromId(id: string) {
    const slashIdx = id.indexOf("/");
    return new InstanceSpec(
        id.substr(0, slashIdx),
        id.substr(slashIdx)
    );
  }

  constructor(public readonly domain: string, public readonly path: string) {
    this.domain = domain;
    this.path = path;
  }

  public get id() {
    return this.domain + this.path;
  }

  public toJS() {
    return {domain: this.domain, path: this.path};
  }
}
