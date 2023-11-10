import semver from 'semver';
import { transformSync } from '@babel/core';
const miniprogramCompat = require('miniprogram-compat');

const browserAlias = {
  ios: 'safari_ios',
};

const moduleAlias = {
  'builtins.AggregateError.AggregateError': 'aggregate-error',
  'builtins.Array.keys': 'array.iterator',
  'builtins.Array.values': 'array.iterator',
  'builtins.Array.entries': 'array.iterator',
  'builtins.Error.Error.options_cause_parameter': 'error.cause',
  'builtins.String.at': 'string.at-alternative',
};

const ignoreModules = [
  /^builtins.Intl/,
  /^builtins.WebAssembly/,
  /^web.dom/,
  /^number.constructor/,
  /^symbol.description/,
];

const featureKeyToCoreJsModule = (featureKey: string) => {
  if (!moduleAlias[featureKey]) {
    moduleAlias[featureKey] = featureKey
      .replace(/^builtins\./, '')
      .replace(/^RegExp/, 'regexp')
      .replace(/(?:^|\.)([A-Z])/g, (m) => m.toLowerCase())
      .replace(/([A-Z])/g, (m) => '-' + m.toLowerCase())
      .replace(/@/g, '');
  }
  return moduleAlias[featureKey];
};

const checkSupported = (featureKey, support, browsers, coreJsModules) => {
  return (
    coreJsModules.has(featureKeyToCoreJsModule(featureKey)) ||
    Object.keys(browsers).every((browser) => {
      const supportBrowserInfo = Array.isArray(support[browser])
        ? support[browser][0]
        : support[browser];
      if (!supportBrowserInfo) console.log(support, browser, browsers);
      const supportBrowserVersion = supportBrowserInfo.version_added;
      return (
        supportBrowserVersion &&
        semver.gte(
          semver.coerce(browsers[browser]),
          semver.coerce(supportBrowserVersion)
        )
      );
    })
  );
};

const _getSupportInfoMap = (jsonData, browsers, coreJsModules) => {
  const supportInfo = new Map();
  coreJsModules.forEach((featureKey) => supportInfo.set(featureKey, true));

  const internalProcess = (featureKey, data) => {
    if (ignoreModules.some((ignoreModule) => ignoreModule.test(featureKey)))
      return;

    if (data.__compat) {
      const compat = data.__compat;
      if (
        compat.status.experimental === false &&
        compat.status.standard_track === true &&
        compat.status.deprecated === false
      ) {
        supportInfo.set(
          // featureKey,
          featureKeyToCoreJsModule(featureKey),
          checkSupported(featureKey, compat.support, browsers, coreJsModules)
        );
      }
    }
    for (const key of Object.keys(data)) {
      if (key === '__compat') continue;
      internalProcess(featureKey ? `${featureKey}.${key}` : key, data[key]);
    }
  };
  internalProcess('', jsonData);
  return supportInfo;
};

function _getMiniprogramPolyfillInfo(miniprogramVersion: string) {
  const browserInfo = miniprogramCompat
    .getBrowsersList(miniprogramVersion)
    .reduce((browsers, info) => {
      const [browser, version] = info.split(' ');
      browsers[browserAlias[browser] || browser] = version;
      return browsers;
    }, {});

  const coreJsModules = new Set(
    miniprogramCompat
      .getPolyfillInfo(miniprogramVersion)
      .coreJsModules.filter((moduleName) => /^es(next)?\./.test(moduleName))
      .map((moduleName) => moduleName.replace(/^es(next)?\./, ''))
  );

  const supportInfo = _getSupportInfoMap(
    require('@mdn/browser-compat-data').javascript,
    browserInfo,
    coreJsModules
  );

  return supportInfo;
}

function _getCurUsePolyfills(code: string) {
  const curUsePolyfills = new Set();
  transformSync(code, {
    presets: [
      [
        '@babel/preset-env',
        {
          corejs: '3',
          useBuiltIns: 'usage',
          targets: {
            browsers: ['iOS >= 8'],
          },
        },
      ],
    ],
    wrapPluginVisitorMethod: (pluginAlias, visitorType, callback) => {
      return (nodePath, state) => {
        if (
          nodePath.isExpressionStatement &&
          pluginAlias === 'inject-polyfills' &&
          nodePath.container.type === 'CallExpression' &&
          nodePath.container.callee.name === 'require' &&
          (nodePath?.parentPath?.container?._blockHoist == '3' ||
            nodePath?.container?._blockHoist == '3')
        ) {
          let value: string = nodePath.container.arguments[0].value;
          if (value?.includes('core-js/modules')) {
            value = value
              .replace('core-js/modules/', '')
              .replace('.js', '')
              .replace(/^es(next)?\./, '');
            curUsePolyfills.add(value);
          }
        }
        callback(nodePath, state);
      };
    },
  });

  return curUsePolyfills;
}

function checkMiniprogramCompat(code: string, version: string): void {
  const supportPolyfills = _getMiniprogramPolyfillInfo(version);
  const curUsePolyfills = _getCurUsePolyfills(code);

  curUsePolyfills.forEach((featureKey: string) => {
    if (ignoreModules.some((ignoreModule) => ignoreModule.test(featureKey)))
      return;

    const isExist = supportPolyfills.has(featureKey);
    const isSupport = supportPolyfills.get(featureKey);

    if (!isExist) {
      console.log('featureKey 不存在 ', featureKey);
    }

    if (!isSupport) {
      throw new Error(`${featureKey} 不支持`);
    }
  });
}

export { checkMiniprogramCompat };
