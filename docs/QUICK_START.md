# Quick Start Guide

Get up and running with the Obsidian Zotero Reader Plugin in just a few minutes!

## 5-Minute Setup

### Step 1: Create Your First Document

1. Create a new Markdown file in your vault
2. Name it something like `My Document.md`

### Step 2: Add Frontmatter

Add this YAML frontmatter to the top of your file:

```yaml
---
zotero-reader: true
source: path/to/your/file.pdf
---
```

**Example:**
```yaml
---
zotero-reader: true
source: Documents/Research Paper.pdf
---
```

**Supported formats:**
- PDF files: `source: folder/document.pdf`
- EPUB files: `source: folder/book.epub` 
- HTML files: `source: folder/page.html`
- Obsidian links: `source: "[[My Document]]"`
- Web URLs: `source: https://example.com/document.pdf`

### Step 3: Open the Reader

1. Look for the Zotero icon (📖) in the file header
2. Click the icon to launch the reader
3. Your document should open in the reader interface!

## Your First Annotation

### Highlighting Text

1. **Select text** in the document by clicking and dragging
2. **Choose highlight color** from the popup toolbar
3. **Click the highlight button** or press `H`
4. The text is now highlighted and saved!

### Adding Comments

1. **Highlight text** (as above)
2. **Click the comment icon** in the annotation
3. **Type your note** in the comment field
4. **Press Enter** or click outside to save

### Viewing Annotations

- **In the reader**: Annotations appear as colored highlights
- **In your note**: Scroll down to see annotation blocks automatically added
- **In the sidebar**: Toggle the annotations panel to see all annotations

## Essential Features

### Copy Links to Text

1. **Right-click** on any selected text
2. Choose **"Copy Link to Selection"**
3. **Paste anywhere** in Obsidian for a direct link back

### Copy Annotation Links

1. **Drag and drop** an annotation from the sidebar to any note
2. Or **select annotation** and press Ctrl/Cmd+C
3. **Paste** to create a link to that specific annotation

### Navigation

- **Zoom**: Mouse wheel or zoom buttons
- **Pages**: Arrow keys, page input field, or thumbnail sidebar
- **Search**: Ctrl/Cmd+F to find text