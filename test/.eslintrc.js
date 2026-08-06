module.exports = {
  root: true,
  plugins: ["jest"],
  extends: ["plugin:jest/recommended"],
  env: {
    browser: true,
    es6: true,
    "jest/globals": true,
  },
  parserOptions: {
    // Without an explicit version espree defaults to ES5 and dies on the first
    // arrow function, so the tests were never actually linted.
    ecmaVersion: 2020,
    sourceType: "module",
  },
};
