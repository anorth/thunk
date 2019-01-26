// From https://github.com/spudly/error-subclass/blob/d3f5cbcc0f58c94a70860cbac1d021457714a794/src/ErrorSubclass.js
// Types added by @anorth.
/*
 Copyright (c) 2015 Stephen Sorensen

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
*/

class ErrorSubclass extends Error {
  constructor(message: string) {
    super(message);

    if (this.constructor === ErrorSubclass) {
      throw new Error("Don't instantiate ErrorSubclass directly. Extend it.");
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      Object.defineProperty(this, "stack", {
        value: (new Error()).stack,
      });
    }

    Object.defineProperty(this, "message", {
      value: message
    });
  }

  get name() {
    return (this as any).constructor.name;
  }

  public toString() {
    return this.name + ": " + this.message;
  }
}

export default ErrorSubclass;
