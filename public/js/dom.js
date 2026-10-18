/**
 * Tiny DOM builder. User supplied values are only ever written through
 * `text`/`textContent`, never through `innerHTML`, which keeps the app free of
 * markup injection. `html` is reserved for trusted static markup.
 */

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (key === 'html') {
      node.innerHTML = String(value); // trusted, developer authored markup only
      continue;
    }
    if (key === 'class' || key === 'className') {
      node.className = String(value);
      continue;
    }
    if (key === 'dataset') {
      Object.assign(node.dataset, value);
      continue;
    }
    if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
      continue;
    }
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    if (key === 'for') {
      node.htmlFor = String(value);
      continue;
    }
    if (key in node) {
      try {
        node[key] = value;
        continue;
      } catch {
        /* fall through to setAttribute */
      }
    }
    node.setAttribute(key, String(value));
  }
}

function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === '') continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
    else node.appendChild(child);
  }
}

/** `el('button.btn.btn--sm#go', { text: 'برو' }, [])` */
export function el(tag, props = {}, children = []) {
  const tokens = String(tag).split(/(?=[.#])/);
  const node = document.createElement(tokens[0] || 'div');
  for (const token of tokens.slice(1)) {
    if (token.startsWith('#')) node.id = token.slice(1);
    else if (token.startsWith('.')) node.classList.add(token.slice(1));
  }
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

export function fragment(children) {
  const frag = document.createDocumentFragment();
  appendChildren(frag, children);
  return frag;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(parent, children) {
  clear(parent);
  appendChildren(parent, children);
  return parent;
}

/** Removes every child of `parent` except the template marker nodes. */
export function setText(node, value) {
  node.textContent = value === null || value === undefined ? '' : String(value);
  return node;
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function on(node, event, handler, options) {
  node.addEventListener(event, handler, options);
  return () => node.removeEventListener(event, handler, options);
}
