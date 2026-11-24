/* WildFire scriptlet shim: edit-object-on-setter.
 * Classic-script module; loaded after registries and before the public API.
 * The JSONPath argument is validated data and only prunes object properties. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};

  function installObjectEditOnSetter(path, spec) {
    const ref = NS.resolvePath(path, false);
    if (!ref) return;
    const descriptor = Object.getOwnPropertyDescriptor(ref.target, ref.key);
    if (!descriptor) return;
    const originalGet = descriptor.get;
    const originalSet = descriptor.set;
    const values = typeof global.WeakMap === 'function'
      ? new global.WeakMap() : null;
    let fallback = descriptor.value;
    NS.redefine(ref.target, ref.key, {
      get: function () {
        if (typeof originalGet === 'function') return originalGet.call(this);
        if (values && this && (typeof this === 'object' || typeof this === 'function')) {
          return values.get(this);
        }
        return fallback;
      },
      set: function (next) {
        const edited = NS.editObject(next, spec);
        if (typeof originalSet === 'function') {
          originalSet.call(this, edited);
          return;
        }
        if (values && this && (typeof this === 'object' || typeof this === 'function')) {
          values.set(this, edited);
        } else {
          fallback = edited;
        }
      },
      enumerable: descriptor.enumerable !== false,
      configurable: true
    });
  }

  NS.DEFINITIONS['edit-object-on-setter'] = {
    aliases: [],
    validate: args => NS.arityError(args, 2, 2) ||
      NS.propertyError(args[0]) || NS.jsonPathError(args[1]),
    run: args => installObjectEditOnSetter(args[0], args[1])
  };

  Object.assign(NS, { installObjectEditOnSetter });
})(this);
