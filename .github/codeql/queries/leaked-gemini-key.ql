/**
 * @name Leaked Gemini API Key
 * @description Detects string literals matching the Gemini API key pattern outside of test/fixture files.
 * @kind problem
 * @problem.severity error
 * @security-severity 9.0
 * @tags security
 *       external/cwe/cwe-798
 */

import javascript

from StringLiteral s
where
  s.getStringValue().regexpMatch("AIza[0-9A-Za-z_\\-]{35}") and
  not s.getFile().getRelativePath().matches("%test%") and
  not s.getFile().getRelativePath().matches("%fixture%") and
  not s.getFile().getRelativePath().matches("%mock%")
select s, "Potential Gemini API key in source code."
