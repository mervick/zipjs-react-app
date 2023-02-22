import "./App.css";
import { useEffect, useState, useRef } from "react";
import { fs } from "@zip.js/zip.js";

const { FS } = fs;
const DEFAULT_MIME_TYPE = "application/octet-stream";
const PARENT_FOLDER_LABEL = "..";
const ROOT_FOLDER_LABEL = "[root]";
const ZIP_EXTENSION = ".zip";
const ROOT_ZIP_FILENAME = "Download" + ZIP_EXTENSION;
const CANCELLED_DOWNLOAD_MESSAGE = "download cancelled";

function App() {
  const [zipFilesystem, setZipFilesystem] = useState(new FS());
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [entries, setEntries] = useState([]);
  const [highlightedEntry, setHighlightedEntry] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const [downloadId, setDownloadId] = useState(0);
  const [clipboardData, setClipboardData] = useState(null);
  const downloader = useRef(null);

  function handleKeyUp(event) {
    if (event.ctrlKey) {
      if (highlightedEntry) {
        if (event.key === "x") {
          onCutEntry();
        }
        if (event.key === "c") {
          onCopyEntry();
        }
        if (event.key === "r") {
          onRenameEntry();
        }
      }
      if (clipboardData) {
        if (event.key === "v") {
          onPasteEntry();
        }
      }
      if (event.key === "d") {
        onCreateFolder();
      }
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      onDeleteEntry();
    }
  }

  function onCreateFolder() {
    const folderName = prompt("Please enter the folder name");
    if (folderName) {
      try {
        const folder = selectedFolder.addDirectory(folderName);
        setHighlightedEntry(folder);
        updateSelectedFolder();
      } catch (error) {
        alert(error.message);
      }
    }
  }

  function onAddFiles(files) {
    files.forEach((file) => {
      try {
        return selectedFolder.addBlob(file.name, file);
      } catch (error) {
        alert(error.message);
      }
    });
    updateSelectedFolder();
  }

  function onCopyEntry() {
    setClipboardData({
      entry: highlightedEntry.clone()
    });
  }

  function onCutEntry() {
    setClipboardData({
      entry: highlightedEntry,
      cut: true
    });
  }

  function onPasteEntry() {
    try {
      const { entry, cut } = clipboardData;
      let clone;
      if (!cut) {
        clone = entry.clone();
      }
      zipFilesystem.move(entry, selectedFolder);
      if (!cut) {
        setClipboardData({ entry: clone });
      }
      updateSelectedFolder();
    } catch (error) {
      alert(error.message);
    }
  }

  function onResetClipboardData() {
    setClipboardData(null);
  }

  function onRenameEntry() {
    try {
      const entryName = prompt(
        "Please enter the entry name",
        highlightedEntry.name
      );
      if (entryName && entryName !== highlightedEntry.name) {
        highlightedEntry.rename(entryName);
        updateSelectedFolder();
      }
    } catch (error) {
      alert(error.message);
    }
  }

  function onDeleteEntry() {
    // eslint-disable-next-line no-restricted-globals
    if (confirm("Please confirm the deletion")) {
      zipFilesystem.remove(highlightedEntry);
      setHighlightedEntry(null);
      updateSelectedFolder();
    }
  }

  function onImportZipFile(zipFile) {
    async function updateZipFile() {
      try {
        await selectedFolder.importBlob(zipFile);
      } catch (error) {
        alert(error.message);
      }
      updateSelectedFolder();
    }

    if (zipFile) {
      updateZipFile();
    }
  }

  function onExportZipFile() {
    downloadFile(
      selectedFolder.name
        ? selectedFolder.name + ZIP_EXTENSION
        : ROOT_ZIP_FILENAME,
      { mimeType: DEFAULT_MIME_TYPE },
      (options) => selectedFolder.exportBlob(options)
    );
  }

  function onReset() {
    // eslint-disable-next-line no-restricted-globals
    if (confirm("Please confirm the reset")) {
      setZipFilesystem(new FS());
    }
  }

  function onHighlightEntry(entry) {
    setHighlightedEntry(entry === highlightedEntry ? null : entry);
  }

  function onGoIntoFolder(entry) {
    setHighlightedEntry(null);
    setSelectedFolder(entry);
  }

  function onDownloadFile(file) {
    downloadFile(file.name, {}, (options) =>
      file.getBlob(DEFAULT_MIME_TYPE, options)
    );
  }

  function onDeleteDownloadEntry(deletedDownload) {
    setDownloads((downloads) =>
      downloads.filter((download) => download.id !== deletedDownload.id)
    );
    deletedDownload.controller.abort(CANCELLED_DOWNLOAD_MESSAGE);
  }

  function updateSelectedFolder() {
    if (selectedFolder) {
      const { parent, children } = selectedFolder;
      const folders = filterChildren(children, true);
      const files = filterChildren(children, false);
      const ancestors = [];
      if (parent) {
        ancestors.push(parent);
      }
      setEntries([...ancestors, ...folders, ...files]);
    }
  }

  function filterChildren(children, isDirectory) {
    return children
      .filter((child) => Boolean(child.directory) === isDirectory)
      .sort((previousChild, nextChild) =>
        previousChild.name.localeCompare(nextChild.name)
      );
  }

  function updateZipFilesystem() {
    const { root } = zipFilesystem;
    setSelectedFolder(root);
    setHighlightedEntry(null);
    setClipboardData(null);
    setEntries([...root.children]);
  }

  async function downloadFile(name, options, blobGetter) {
    name = prompt("Please enter the file name", name);
    if (name) {
      const controller = new AbortController();
      const progressValue = null;
      const progressMax = null;
      const id = downloadId + 1;
      setDownloadId(() => id);
      const download = { id, name, controller, progressValue, progressMax };
      setDownloads((downloads) => [download, ...downloads]);
      const { signal } = controller;
      const onprogress = (progressValue, progressMax) =>
        onDownloadProgress(download.id, progressValue, progressMax);
      Object.assign(options, {
        signal,
        onprogress,
        bufferedWrite: true,
        keepOrder: true
      });
      try {
        const blob = await blobGetter(options);
        downloadBlob(blob, downloader.current, download.name);
      } catch (error) {
        const message = error.message || error;
        if (
          message !== CANCELLED_DOWNLOAD_MESSAGE &&
          error.name !== "AbortError"
        ) {
          alert(message);
        }
      } finally {
        onDeleteDownloadEntry(download);
      }
    }
  }

  function onDownloadProgress(downloadId, progressValue, progressMax) {
    setDownloads((downloads) =>
      downloads.map((download) => {
        if (download.id === downloadId) {
          download = {
            ...download,
            progressValue,
            progressMax
          };
        }
        return download;
      })
    );
  }

  useEffect(updateSelectedFolder, [selectedFolder]);
  useEffect(updateZipFilesystem, [zipFilesystem]);
  useEffect(() => {
    window.addEventListener("keyup", handleKeyUp);
    return () => window.removeEventListener("keyup", handleKeyUp);
  });
  return (
    <div className="application">
      <TopButtonBar
        entriesLength={entries.length}
        onCreateFolder={onCreateFolder}
        onAddFiles={onAddFiles}
        onImportZipFile={onImportZipFile}
        onExportZipFile={onExportZipFile}
        onReset={onReset}
      />
      <Breadcrumb folder={selectedFolder} onGoIntoFolder={onGoIntoFolder} />
      <Entries
        entries={entries}
        parentFolder={selectedFolder && selectedFolder.parent}
        highlightedEntry={highlightedEntry}
        onHighlightEntry={onHighlightEntry}
        onGoIntoFolder={onGoIntoFolder}
        onDownloadFile={onDownloadFile}
      />
      <BottomButtonBar
        highlightedEntry={highlightedEntry}
        clipboardData={clipboardData}
        onCopyEntry={onCopyEntry}
        onCutEntry={onCutEntry}
        onPasteEntry={onPasteEntry}
        onResetClipboardData={onResetClipboardData}
        onRenameEntry={onRenameEntry}
        onDeleteEntry={onDeleteEntry}
      />
      <DownloadManager
        downloads={downloads}
        downloader={downloader}
        onDeleteDownloadEntry={onDeleteDownloadEntry}
      />
    </div>
  );
}

async function downloadBlob(blob, downloaderElement, download) {
  const href = URL.createObjectURL(blob);
  Object.assign(downloaderElement, { href, download });
  downloaderElement.click();
  URL.revokeObjectURL(href);
}

function TopButtonBar({
  entriesLength,
  onCreateFolder,
  onAddFiles,
  onImportZipFile,
  onExportZipFile,
  onReset
}) {
  return (
    <div className="button-bar">
      <div className="button-group">
        <CreateFolderButton onCreateFolder={onCreateFolder} />
        <AddFilesButton onAddFiles={onAddFiles} />
      </div>
      <div className="button-group">
        <ImportZipButton onImportZipFile={onImportZipFile} />
        <ExportZipButton
          disabled={!entriesLength}
          onExportZipFile={onExportZipFile}
        />
      </div>
      <div className="button-group">
        <ResetButton disabled={!entriesLength} onReset={onReset} />
      </div>
    </div>
  );
}

function CreateFolderButton({ onCreateFolder }) {
  return <button onClick={onCreateFolder}>Create directory</button>;
}

function AddFilesButton({ onAddFiles }) {
  const fileInput = useRef(null);
  const { current } = fileInput;

  function handleChange({ target }) {
    const files = Array.from(target.files);
    current.value = "";
    if (files.length) {
      onAddFiles(files);
    }
  }

  function dispatchEvent() {
    current.dispatchEvent(new MouseEvent("click"));
  }

  return (
    <>
      <button onClick={dispatchEvent}>Add files</button>
      <input
        onChange={handleChange}
        ref={fileInput}
        type="file"
        multiple
        hidden
      />
    </>
  );
}

function ImportZipButton({ onImportZipFile }) {
  const fileInput = useRef(null);
  const { current } = fileInput;

  function dispatchEvent() {
    current.dispatchEvent(new MouseEvent("click"));
  }

  return (
    <>
      <button onClick={dispatchEvent}>Import zip file</button>
      <input
        onChange={({ target }) => onImportZipFile(target.files[0])}
        ref={fileInput}
        type="file"
        accept=".zip"
        hidden
      />
    </>
  );
}

function ExportZipButton({ disabled, onExportZipFile }) {
  return (
    <button onClick={onExportZipFile} disabled={disabled}>
      Export zip file
    </button>
  );
}

function ResetButton({ disabled, onReset }) {
  return (
    <button onClick={onReset} disabled={disabled}>
      Reset
    </button>
  );
}

function Breadcrumb({ folder, onGoIntoFolder }) {
  const folderAncestors = [];
  const lastItemFolder = folder;

  function getBreadcrumbItemClassName(itemFolder) {
    const classes = ["breadcrumb-item"];
    if (folderAncestors.length > 1 && itemFolder !== lastItemFolder) {
      classes.push("breadcrumb-item-active");
    }
    return classes.join(" ");
  }

  function getTabIndex(itemFolder) {
    if (folderAncestors.length > 1 && itemFolder !== lastItemFolder) {
      return 0;
    } else {
      return null;
    }
  }

  function handleClick() {
    onGoIntoFolder(folder);
  }

  function handleKeyUp(event) {
    if (event.key === "Enter") {
      handleClick();
    }
  }

  while (folder && folder.parent) {
    folderAncestors.unshift(folder);
    folder = folder.parent;
  }
  if (folder) {
    folderAncestors.unshift(folder);
  }
  return (
    <ol className="breadcrumb">
      {folderAncestors.map((folder) => (
        <li key={folder.id}>
          <span
            className={getBreadcrumbItemClassName(folder)}
            onClick={handleClick}
            onKeyUp={handleKeyUp}
            tabIndex={getTabIndex(folder)}
          >
            {folder.parent ? folder.name : ROOT_FOLDER_LABEL}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Entries({
  entries,
  parentFolder,
  highlightedEntry,
  onHighlightEntry,
  onGoIntoFolder,
  onDownloadFile
}) {
  function getEntryClassName(entry) {
    const classes = [];
    if (entry.directory) {
      classes.push("directory");
    }
    if (entry === highlightedEntry) {
      classes.push("entry-highlighted");
    }
    return classes.join(" ");
  }

  function onActionEntry(entry) {
    if (entry.directory) {
      onGoIntoFolder(entry);
    } else {
      onDownloadFile(entry);
    }
  }

  return (
    <ol className="entries">
      {entries.map((entry) => (
        <li key={entry.id} className={getEntryClassName(entry)}>
          <Entry
            entry={entry}
            parentFolder={parentFolder}
            onHighlightEntry={onHighlightEntry}
            onActionEntry={onActionEntry}
          />
        </li>
      ))}
    </ol>
  );
}

function Entry({ entry, parentFolder, onHighlightEntry, onActionEntry }) {
  return (
    <>
      <EntryName
        entry={entry}
        parentFolder={parentFolder}
        onHighlightEntry={onHighlightEntry}
        onActionEntry={onActionEntry}
      />
      <EntryButton entry={entry} onActionEntry={onActionEntry} />
    </>
  );
}

function EntryName({ entry, parentFolder, onHighlightEntry, onActionEntry }) {
  const isParentEntry = entry === parentFolder;

  function handleKeyUp(event) {
    if (event.key === " ") {
      handleClick();
    }
    if (event.key === "Enter") {
      handleDoubleClick(entry);
      event.stopPropagation();
    }
  }

  function handleClick() {
    if (!isParentEntry) {
      onHighlightEntry(entry);
    }
  }

  function handleDoubleClick() {
    onActionEntry(entry);
  }

  return (
    <span
      className="list-item-name entry-name"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyUp={handleKeyUp}
      tabIndex="0"
    >
      {isParentEntry ? PARENT_FOLDER_LABEL : entry.name}
    </span>
  );
}

function EntryButton({ entry, onActionEntry }) {
  function getButtonClassName() {
    const classes = ["list-item-button"];
    classes.push(entry.directory ? "navigate-button" : "download-button");
    return classes.join(" ");
  }

  function handleClick() {
    onActionEntry(entry);
  }

  function handleKeyUp(event) {
    if (event.key === "Enter") {
      handleClick();
    }
  }

  return (
    <span
      className={getButtonClassName()}
      onClick={handleClick}
      onKeyUp={handleKeyUp}
      tabIndex="0"
    >
      {entry.directory ? "↵" : "↓"}
    </span>
  );
}

function BottomButtonBar({
  highlightedEntry,
  clipboardData,
  onCopyEntry,
  onCutEntry,
  onPasteEntry,
  onResetClipboardData,
  onRenameEntry,
  onDeleteEntry
}) {
  return (
    <div className="button-bar button-bar-bottom">
      <div className="button-group">
        <CopyEntryButton
          disabled={!highlightedEntry}
          onCopyEntry={onCopyEntry}
        />
        <CutEntryButton disabled={!highlightedEntry} onCutEntry={onCutEntry} />
        <PasteEntryButton
          disabled={!clipboardData}
          onPasteEntry={onPasteEntry}
        />
        <ResetClipboardDataButton
          disabled={!clipboardData}
          onResetClipboardData={onResetClipboardData}
        />
      </div>
      <div className="button-group">
        <RenameEntryButton
          disabled={!highlightedEntry}
          onRenameEntry={onRenameEntry}
        />
        <DeleteEntryButton
          disabled={!highlightedEntry}
          onDeleteEntry={onDeleteEntry}
        />
      </div>
    </div>
  );
}

function CopyEntryButton({ disabled, onCopyEntry }) {
  return (
    <button onClick={onCopyEntry} disabled={disabled}>
      Copy
    </button>
  );
}

function CutEntryButton({ disabled, onCutEntry }) {
  return (
    <button onClick={onCutEntry} disabled={disabled}>
      Cut
    </button>
  );
}

function PasteEntryButton({ disabled, onPasteEntry }) {
  return (
    <button onClick={onPasteEntry} disabled={disabled}>
      Paste
    </button>
  );
}

function ResetClipboardDataButton({ disabled, onResetClipboardData }) {
  return (
    <button onClick={onResetClipboardData} disabled={disabled}>
      Reset clipboard
    </button>
  );
}

function RenameEntryButton({ disabled, onRenameEntry }) {
  return (
    <button onClick={onRenameEntry} disabled={disabled}>
      Rename
    </button>
  );
}

function DeleteEntryButton({ disabled, onDeleteEntry }) {
  return (
    <button onClick={onDeleteEntry} disabled={disabled}>
      Delete
    </button>
  );
}

function DownloadManager({ downloads, downloader, onDeleteDownloadEntry }) {
  return (
    <div className="downloads">
      <ol>
        {downloads.map((download) => (
          <li key={download.id}>
            <DownloadEntry
              download={download}
              onDeleteDownloadEntry={onDeleteDownloadEntry}
            />
          </li>
        ))}
      </ol>
      {/* eslint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/anchor-is-valid */}
      <a hidden ref={downloader} />
    </div>
  );
}

function DownloadEntry({ download, onDeleteDownloadEntry }) {
  return (
    <>
      <DownloadEntryInfo
        download={download}
        onDeleteDownloadEntry={onDeleteDownloadEntry}
      />
      <DownloadEntryProgress download={download} />
    </>
  );
}

function DownloadEntryInfo({ download, onDeleteDownloadEntry }) {
  return (
    <div className="download-entry">
      <span className="list-item-name download-entry-name">
        {download.name}
      </span>
      <DeleteDownloadEntryButton
        download={download}
        onDeleteDownloadEntry={onDeleteDownloadEntry}
      />
    </div>
  );
}

function DeleteDownloadEntryButton({ download, onDeleteDownloadEntry }) {
  function handleClick() {
    onDeleteDownloadEntry(download);
  }

  function handleKeyUp(event) {
    if (event.key === "Enter") {
      handleClick();
    }
  }

  return (
    <span
      className="list-item-button"
      onClick={handleClick}
      onKeyUp={handleKeyUp}
      tabIndex="0"
    >
      ✕
    </span>
  );
}

function DownloadEntryProgress({ download }) {
  return <progress value={download.progressValue} max={download.progressMax} />;
}

export default App;
