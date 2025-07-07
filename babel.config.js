/**
 * Babel Configuration for CollectFlo
 * 
 * This configuration enables Jest to process modern JavaScript syntax
 * when running tests. It uses @babel/preset-env to automatically determine
 * the Babel plugins needed based on the specified Node.js version.
 */

module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: '18'
        },
        modules: 'commonjs',
        useBuiltIns: 'usage',
        corejs: '3.0.0'
      }
    ]
  ],
  env: {
    test: {
      plugins: [
        // Add any test-specific plugins here if needed
      ]
    }
  },
  // Ignore node_modules by default
  ignore: [
    'node_modules'
  ],
  // Cache babel transformations for faster test runs
  cache: true
};
