TMPFILE=$(mktemp)
printf 'feat(ssf): add CorrectionEvent aggregate\n\nspec: correctionevent-server-persistence\n' > "$TMPFILE"
set -- "$TMPFILE"
