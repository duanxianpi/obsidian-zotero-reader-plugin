# Troubleshooting Guide

Common issues and solutions for the Obsidian Zotero Reader Plugin.

## 🚨 Common Issues

### Plugin Installation

#### "Plugin doesn't appear in Community Plugins"
**Solution:**
1. Ensure Community plugins are enabled in Settings
2. Reload Obsidian (Ctrl/Cmd + R)
3. Check if BRAT plugin is properly installed and enabled

#### "BRAT can't find the repository"
**Solution:**
- Verify the exact repository name: `duanxianpi/obsidian-zotero-reader-plugin`
- Check your internet connection
- Wait a few minutes and try again (GitHub API rate limits)

#### "Plugin installed but won't enable"
**Solution:**
1. Check Obsidian version (requires v0.15.0+)
2. Disable and re-enable the plugin
3. Check browser console (Ctrl/Cmd+Shift+I) for error messages

### Reader Issues

#### "Reader icon doesn't appear"
**Possible causes:**
- Missing `zotero-reader: true` in frontmatter
- Invalid YAML syntax
- Plugin is disabled

**Solution:**
1. Verify frontmatter format:
   ```yaml
   ---
   zotero-reader: true
   source: path/to/file.pdf
   ---
   ```
2. Check that plugin is enabled in Settings
3. Reload the note or restart Obsidian

#### "Document won't open in reader"
**Possible causes:**
- File path is incorrect
- File doesn't exist
- Unsupported file format
- File permissions issue

**Solution:**
1. **Check file path**: Ensure the path in `source:` is correct
2. **Use absolute paths**: Try full path from vault root
3. **Try Obsidian links**: Use `source: "[[Document Name]]"` format
4. **Check file existence**: Verify the file exists in your vault
5. **Test with different file**: Try a known working PDF

#### "Reader loads but document is blank"
**Solution:**
1. **PDF issues**: Try opening the PDF in another application to verify it's not corrupted
2. **EPUB issues**: Check if the EPUB file is valid
3. **Large files**: Wait longer for large documents to load
4. **Browser console**: Check for JavaScript errors (F12)

#### "Annotations don't appear in the note"
**Solution:**
1. **Save the document**: Ensure you've saved after making annotations
2. **Check template**: Verify annotation template in settings isn't broken
3. **Refresh view**: Close and reopen the note
4. **Check frontmatter**: Ensure `zotero-reader: true` is present

### Annotation Issues

#### "Can't create annotations"
**Solution:**
1. Check if document is in read-only mode
2. Verify you're using a supported annotation tool
3. Try selecting text first, then choosing annotation type
4. Check if the PDF allows annotations (some PDFs have restrictions)

#### "Annotations disappear"
**Solution:**
1. **Save regularly**: Always save the document after annotating
2. **Check storage**: Ensure vault has write permissions
3. **Backup vault**: Regular backups prevent data loss
4. **Update plugin**: Ensure you're running the latest version

#### "Template errors in annotations"
**Solution:**
1. **Reset template**: Use "Reset to Default" button in settings
2. **Check syntax**: Verify Nunjucks template syntax
3. **Test incrementally**: Make small template changes and test
4. **Check variables**: Ensure you're using valid template variables

### Performance Issues

#### "Reader is slow or laggy"
**Solution:**
1. **Large files**: Break large documents into smaller sections
2. **Close other readers**: Limit to one reader instance
3. **Restart Obsidian**: Fresh start can resolve memory issues
4. **Check system resources**: Ensure adequate RAM and CPU

#### "Obsidian crashes when using reader"
**Solution:**
1. **Update Obsidian**: Ensure latest version
2. **Disable other plugins**: Test with minimal plugin setup
3. **Check memory usage**: Close unnecessary applications
4. **Report the crash**: File a bug report with crash details

### File Format Issues

#### "PDF won't display properly"
**Solution:**
- **Try different PDF**: Test with a known working PDF
- **Check PDF version**: Very old or new PDF versions might have issues  
- **Flatten PDF**: Try saving the PDF in a different format
- **File size**: Very large PDFs (>100MB) may have loading issues

#### "EPUB formatting looks wrong"
**Solution:**
- **CSS conflicts**: Some EPUB styles might conflict with Obsidian themes
- **Font issues**: Try changing the font family in reader settings
- **Zoom level**: Adjust zoom to improve readability

#### "HTML files don't load"
**Solution:**
- **Local files only**: Ensure HTML file is stored locally in your vault
- **Check dependencies**: HTML files with external resources might not load properly
- **Test in browser**: Verify the HTML file works in a web browser first

## 🔧 Debug Mode

### Enable Debug Information

1. **Open Developer Console**:
   - Windows/Linux: `Ctrl + Shift + I`
   - macOS: `Cmd + Option + I`

2. **Check Console Tab**: Look for error messages related to the plugin

3. **Enable Plugin Debug Mode**: Add this to your plugin settings to get more detailed logs

### What to Look For

**Common error patterns:**
- `TypeError: Cannot read property...` - Usually missing template variables
- `SyntaxError: Unexpected token...` - Often YAML frontmatter syntax issues
- `Failed to load resource...` - File path or network issues
- `Permission denied...` - File access issues

## 📝 Reporting Issues

### Before Reporting

1. **Check this guide** for existing solutions
2. **Search existing issues** on GitHub
3. **Try with minimal setup** (disable other plugins temporarily)
4. **Update everything** (Obsidian, plugin, BRAT)

### What to Include

When reporting issues, please include:

- **Obsidian version**
- **Plugin version**
- **Operating system**
- **Steps to reproduce**
- **Error messages** from console
- **Sample file** (if safe to share)
- **Minimal frontmatter** example that demonstrates the issue

### Where to Report

1. **[GitHub Issues](https://github.com/duanxianpi/obsidian-zotero-reader-plugin/issues)** - For bugs and feature requests
2. **[Discord Community](https://discord.gg/KwTkAhVc)** - For general help and discussion

## 🆘 Emergency Fixes

### Plugin Won't Start

1. **Disable plugin**: Settings → Community plugins → Toggle off
2. **Restart Obsidian**: Complete restart
3. **Re-enable plugin**: Toggle back on
4. **If still broken**: Reinstall via BRAT

### Corrupted Settings

1. **Reset to defaults**: Use reset buttons in plugin settings
2. **Clear plugin data**: 
   - Go to `VaultFolder/.obsidian/plugins/obsidian-zotero-reader-plugin/`
   - Delete `data.json` file
   - Restart Obsidian

### Complete Reset

If all else fails:
1. **Backup your annotations**: Copy annotation blocks from your notes
2. **Uninstall plugin**: Remove via BRAT or manually delete plugin folder
3. **Restart Obsidian**
4. **Reinstall plugin**: Fresh installation via BRAT
5. **Restore settings**: Reconfigure according to your preferences

---

## 💡 Prevention Tips

- **Regular updates**: Keep Obsidian and plugins updated
- **Backup vault**: Regular backups prevent data loss
- **Test changes**: Test template changes on sample documents first
- **Document issues**: Keep notes on what works and what doesn't
- **Community**: Join Discord for tips and early issue reports