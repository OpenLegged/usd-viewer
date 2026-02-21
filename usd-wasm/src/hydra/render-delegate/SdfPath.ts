class SdfPath {
  declare GetName: () => string;
  declare AbsoluteRootPath: () => string;
  declare ReflexiveRelativePath: () => string;

  get name(): string {
    return this.GetName();
  }

  get absoluteRootPath(): string {
    return this.AbsoluteRootPath();
  }

  get reflexiveRelativePath(): string {
    return this.ReflexiveRelativePath();
  }
}

export { SdfPath };
