const vendor = new URL('../../vendor/three/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
  for (const prefix of ['three/addons/', 'three/examples/jsm/']) {
    if (specifier.startsWith(prefix)) return { url: new URL('examples/jsm/' + specifier.slice(prefix.length), vendor).href, shortCircuit: true };
  }
  return next(specifier, context);
}
