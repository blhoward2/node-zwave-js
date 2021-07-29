"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.libVersion = void 0;
// This module is the main entry point. Requiring reflect-metadata here avoids forgetting it
require("reflect-metadata");
const path = __importStar(require("path"));
// By installing source map support, we get the original source
// locations in error messages
require("source-map-support/register");
const sentry_1 = require("./build/lib/telemetry/sentry");
/** The version of zwave-js, exported for your convenience */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require("zwave-js/package.json");
const libraryRootDir = path.join(require("path").join(__dirname, "./build"), "..");
const libName = packageJson.name;
const libVersion = packageJson.version;
exports.libVersion = libVersion;
// Init sentry, unless we're running a a test or some custom-built userland or PR test versions
if (process.env.NODE_ENV !== "test" &&
    !/\-[a-f0-9]{7,}$/.test(libVersion) &&
    !/\-pr\-\d+\-$/.test(libVersion)) {
    void sentry_1.initSentry(libraryRootDir, libName, libVersion).catch(() => {
        /* ignore */
    });
}
// Export some frequently-used things and types - this also loads all CC files including metadata
__exportStar(require("./CommandClass"), exports);
__exportStar(require("./Controller"), exports);
__exportStar(require("./Driver"), exports);
__exportStar(require("./Error"), exports);
__exportStar(require("./Node"), exports);
__exportStar(require("./Utils"), exports);
__exportStar(require("./Values"), exports);

//# sourceMappingURL=index.js.map
