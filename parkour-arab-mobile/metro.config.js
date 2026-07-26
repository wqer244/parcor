const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// .glb/.gltf 3D models need to be treated as binary assets (like images),
// not parsed as source — otherwise Metro tries to run them as JS.
config.resolver.assetExts = [...config.resolver.assetExts, 'glb', 'gltf'];

module.exports = config;
