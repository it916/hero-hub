// Foto de perfil de Google del usuario autenticado.
//
// El perfil top-level (`user.photoURL`) lo cachea Firebase en el primer login
// y no se refresca solo: si alguien inicia sesión sin foto y la agrega después,
// `photoURL` sigue devolviendo la silueta vieja. La foto que Google actualiza en
// cada login vive en `providerData`. Por eso priorizamos providerData y dejamos
// `photoURL` solo como respaldo.

export function getGooglePhotoURL(user) {
  const g = user?.providerData?.find(p => p.providerId === "google.com");
  return (g && g.photoURL) || user?.photoURL || "";
}

// Refresca el perfil desde Firebase y devuelve la URL de foto más fresca.
export async function getFreshGooglePhotoURL(user) {
  try { await user?.reload?.(); } catch (e) { /* sin refrescar: usamos lo cacheado */ }
  return getGooglePhotoURL(user);
}
