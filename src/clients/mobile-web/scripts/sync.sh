#!/bin/bash
# ShramSafal Git Sync Script (Unix/Mac/WSL)
# Usage: ./scripts/sync.sh "your commit message"
# Example: ./scripts/sync.sh "fix: voice parsing guards for spray dose"

set -e

MSG="${1:-wip: work in progress}"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}=========================================${NC}"
echo -e "${CYAN}ShramSafal Git Sync${NC}"
echo -e "${CYAN}=========================================${NC}"

# Check if we're in a git repo
if [ ! -d ".git" ]; then
    echo -e "${RED}Error: Not in a git repository!${NC}"
    exit 1
fi

# Check for changes
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}No changes to commit.${NC}"
    exit 0
fi

echo -e "\n${CYAN}Staging all changes...${NC}"
git add -A

echo -e "\n${CYAN}Changes to be committed:${NC}"
git status --short

echo -e "\n${CYAN}Committing with message: '$MSG'${NC}"
git commit -m "$MSG"

echo -e "\n${CYAN}Pushing to remote...${NC}"
if ! git push 2>/dev/null; then
    echo -e "${YELLOW}Push failed - remote may not be configured yet.${NC}"
    echo -e "${CYAN}Run: git remote add origin https://github.com/YOUR_USERNAME/ShramSafal.git${NC}"
    echo -e "${CYAN}Then: git push -u origin main${NC}"
    exit 1
fi

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}Sync complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
