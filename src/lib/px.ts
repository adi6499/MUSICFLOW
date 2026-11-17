// Preact 11 stopped turning plain numbers in inline styles into pixels
// (`marginTop: 18` used to mean 18px; now the browser ignores it).
// Music Flow's components write sizes as plain numbers, so this restores that one
// behaviour, using the same rule Preact 10 used: numbers get "px" unless the
// property is one that is naturally unit-less (opacity, flex, z-index, …).
//
// Must be imported before anything is rendered.

import { options } from 'preact';

const UNITLESS = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera|^aspect|^scale$/i;

const earlier = options.vnode;
options.vnode = (vnode) => {
  if (typeof vnode.type === 'string') {
    const props = vnode.props as { style?: unknown };
    const style = props.style;
    if (style && typeof style === 'object') {
      let fixed: Record<string, unknown> | null = null;
      const map = style as Record<string, unknown>;
      for (const key in map) {
        const value = map[key];
        if (typeof value === 'number' && value !== 0 && key[0] !== '-' && !UNITLESS.test(key)) {
          if (!fixed) fixed = { ...map };
          fixed[key] = value + 'px';
        }
      }
      if (fixed) props.style = fixed;
    }
  }
  if (earlier) earlier(vnode);
};
