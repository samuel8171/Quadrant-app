# Visual self-check

These prompts are optional references for checking the portrait layouts. The image endpoint is not part of the app and the API key must stay in the local environment.

```powershell
$env:RIGHTAPI_API_KEY = "<your-key>"
node scripts/visual-self-check.mjs --prompt-file docs/visual-self-check/weekly-prompt.txt --output docs/visual-self-check/weekly.png
node scripts/visual-self-check.mjs --prompt-file docs/visual-self-check/quadrant-prompt.txt --output docs/visual-self-check/quadrant.png
```

Defaults: endpoint `https://www.rightapi.ai/draw`, model `gpt-image-2`. If the endpoint is unavailable, keep the concrete error output and continue with local browser screenshots.

Check 375×667, 390×844, 430×932, and 1280×800. Verify no page-level horizontal overflow, bottom safe-area clearance, 44px touch targets, readable weekly events/today marker, and the original quadrant positions/colors.
