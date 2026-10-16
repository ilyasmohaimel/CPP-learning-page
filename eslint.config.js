import tseslint from 'typescript-eslint';
export default tseslint.config(
  {ignores:['dist/**','node_modules/**','test-results/**','playwright-report/**']},
  ...tseslint.configs.recommended,
  {files:['**/*.ts','**/*.tsx'],rules:{'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_',ignoreRestSiblings:true}],'no-empty':['error',{allowEmptyCatch:true}]}}
);
