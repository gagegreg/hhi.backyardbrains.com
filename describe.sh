OUTPUT_FILE="current_project.txt"

# Remove the old combined file, if any
rm -f "$OUTPUT_FILE"

echo "Combining specified files from '.' and './src' into $OUTPUT_FILE..."

##
# 1) Print a 'tree' view into the file for verification
##
echo "===== Project Tree =====" >> "$OUTPUT_FILE"
tree \
  . ./src \
  -I 'node_modules|\.git|\.DS_Store|.*\.lock|venv|webgazer\.js' \
  -P '*.py|*.js|*.html|*.ts|*.tsx|*.json|*.css|.env' \
  --prune \
  >> "$OUTPUT_FILE"
