/* WildFire - background-side native port channels built on the Firefox wapi. */
(function (global) {
  'use strict';

  const api = global.WildFireWapiBackground = global.WildFireWapiBackground || {};
  try { global.wapiBackground = api; } catch (error) { /* the canonical global still works */ }

  function create(options) {
    const config = options || {};
    const wapi = config.wapi;
    const prefix = config.prefix || (wapi && wapi.prefix) || 'wildfire:';
    const channels = new Map();
    let connected = false;

    function channelFor(port) {
      const name = String((port && port.name) || '');
      return name.startsWith(prefix) ? name.slice(prefix.length) : '';
    }

    function detach(port) {
      Array.from(channels.entries()).forEach(([name, ports]) => {
        ports.delete(port);
        if (!ports.size) channels.delete(name);
      });
    }

    function attach(port) {
      const name = channelFor(port);
      if (!name || !port || typeof port.postMessage !== 'function') return false;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(port);
      if (port.onDisconnect && typeof port.onDisconnect.addListener === 'function') {
        port.onDisconnect.addListener(() => detach(port));
      }
      return true;
    }

    function connect() {
      if (connected || !wapi || !wapi.events) return false;
      const event = wapi.browser && wapi.browser.runtime &&
        wapi.browser.runtime.onConnect;
      if (!event || typeof event.addListener !== 'function') return false;
      if (!wapi.events.add('runtime.onConnect', event, attach)) return false;
      connected = true;
      return true;
    }

    function broadcast(channel, payload) {
      const ports = channels.get(String(channel));
      if (!ports) return 0;
      let delivered = 0;
      Array.from(ports).forEach(port => {
        try {
          port.postMessage(payload);
          delivered += 1;
        } catch (error) {
          detach(port);
        }
      });
      return delivered;
    }

    function size(channel) {
      if (channel === undefined) {
        return Array.from(channels.values()).reduce((total, ports) => total + ports.size, 0);
      }
      const ports = channels.get(String(channel));
      return ports ? ports.size : 0;
    }

    function channelNames() {
      return Array.from(channels.keys());
    }

    function close() {
      if (connected && wapi && wapi.events) wapi.events.remove('runtime.onConnect');
      connected = false;
      channels.clear();
    }

    if (config.autoStart !== false) connect();

    return {
      prefix,
      connect,
      detach,
      broadcast,
      size,
      channelNames,
      close,
      get connected() { return connected; }
    };
  }

  api.create = create;
})(this);
