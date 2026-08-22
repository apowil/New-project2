import { useEffect } from 'react';

import { session, useStore } from '../state/store.js';
import {
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  PlusIcon,
  RenameIcon,
  TrashIcon,
  UploadIcon,
} from './Icons.js';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ProjectsPanel() {
  const open = useStore((state) => state.projectsOpen);
  const projects = useStore((state) => state.projects);
  const setOpen = useStore((state) => state.setProjectsOpen);
  const openProject = useStore((state) => state.openProject);
  const deleteProject = useStore((state) => state.deleteProject);
  const newSketch = useStore((state) => state.newSketch);
  const exportSketch = useStore((state) => state.exportSketch);
  const importSketch = useStore((state) => state.importSketch);
  const renameProject = useStore((state) => state.renameProject);
  const duplicateProject = useStore((state) => state.duplicateProject);
  const persistent = useStore((state) => state.storageIsPersistent);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const currentId = session.document.id;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-scrim/75 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Sketches"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="panel flex h-full max-h-[42rem] w-full max-w-4xl flex-col">
        <header className="flex items-center gap-3 border-b border-line/70 px-5 py-3">
          <h2 className="flex-1 text-sm font-medium text-primary">Sketches</h2>

          <button
            type="button"
            onClick={() => void importSketch()}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-secondary transition-colors hover:bg-line/70"
            title="Open a .wisp file from this device"
          >
            <UploadIcon />
            Import
          </button>

          <button
            type="button"
            onClick={exportSketch}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-secondary transition-colors hover:bg-line/70"
            title="Save the current sketch as a .wisp file"
          >
            <DownloadIcon />
            Export
          </button>

          <button
            type="button"
            onClick={() => void newSketch()}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            <PlusIcon />
            New sketch
          </button>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="tool-button h-9 w-9"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        {!persistent && (
          <p className="border-b border-line/70 px-5 py-2 text-xs" style={{ color: 'var(--color-danger)' }}>
            This browser is not letting Wisp store anything, so sketches will
            not survive a reload. Export to a file to keep your work.
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {projects.length === 0 ? (
            <p className="pt-12 text-center text-sm text-muted">
              Nothing saved yet. Draw something and it will appear here.
            </p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
              {projects.map((project) => {
                const isCurrent = project.id === currentId;
                return (
                  <li key={project.id}>
                    <div
                      className="group relative overflow-hidden rounded-xl border transition-colors"
                      style={{
                        borderColor: isCurrent
                          ? 'var(--color-accent)'
                          : 'var(--color-line)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => void openProject(project.id)}
                        className="block w-full text-left"
                        title={isCurrent ? 'Currently open' : `Open ${project.name}`}
                      >
                        <div className="aspect-4/3 w-full bg-canvas">
                          {project.thumbnail ? (
                            <img
                              src={project.thumbnail}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-faint">
                              No preview
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-0.5 px-3 py-2">
                          <span className="truncate text-sm text-primary">{project.name}</span>
                          <span className="text-[11px] text-muted">
                            {project.strokeCount} stroke
                            {project.strokeCount === 1 ? '' : 's'} ·{' '}
                            {formatDate(project.updatedAt)}
                          </span>
                        </div>
                      </button>

                      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => {
                            const next = window.prompt('Rename sketch', project.name);
                            if (next !== null) void renameProject(project.id, next);
                          }}
                          className="rounded-lg bg-surface/90 p-1.5 text-secondary transition-colors hover:text-primary"
                          aria-label={`Rename ${project.name}`}
                          title="Rename"
                        >
                          <RenameIcon />
                        </button>

                        <button
                          type="button"
                          onClick={() => void duplicateProject(project.id)}
                          className="rounded-lg bg-surface/90 p-1.5 text-secondary transition-colors hover:text-primary"
                          aria-label={`Duplicate ${project.name}`}
                          title="Duplicate"
                        >
                          <CopyIcon />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete "${project.name}"? This cannot be undone.`)) {
                              void deleteProject(project.id);
                            }
                          }}
                          className="rounded-lg bg-surface/90 p-1.5 text-secondary transition-colors hover:text-danger"
                          aria-label={`Delete ${project.name}`}
                          title="Delete"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
