'use strict';
import * as paths from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitFile, GitUri } from '../../git/gitService';
import { Arrays, debug, gate, Iterables, Promises, Strings } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { FileNode, FolderNode } from './folderNode';
import { ResultsFileNode } from './resultsFileNode';
import { ResourceType, ViewNode } from './viewNode';

export interface FilesQueryResults {
    label: string;
    diff: GitFile[] | undefined;
}

export class ResultsFilesNode extends ViewNode<ViewWithFiles> {
    constructor(
        view: ViewWithFiles,
        parent: ViewNode,
        public readonly repoPath: string,
        public readonly ref1: string,
        public readonly ref2: string
    ) {
        super(GitUri.fromRepoPath(repoPath), view, parent);
    }

    get id(): string {
        return `${this.parent!.id}:results:files`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const { diff } = await this.getFilesQueryResults();
        if (diff === undefined) return [];

        let children: FileNode[] = [
            ...Iterables.map(diff, s => new ResultsFileNode(this.view, this, this.repoPath, s, this.ref1, this.ref2))
        ];

        if (this.view.config.files.layout !== ViewFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(
                children,
                n => n.uri.relativePath.split('/'),
                (...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
                this.view.config.files.compact
            );

            const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
            children = (await root.getChildren()) as FileNode[];
        }
        else {
            children.sort(
                (a, b) =>
                    a.priority - b.priority ||
                    a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' })
            );
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let label;
        let diff;
        let state;

        try {
            ({ label, diff } = await Promises.timeout(this.getFilesQueryResults(), 100));
            state =
                diff == null || diff.length === 0 ? TreeItemCollapsibleState.None : TreeItemCollapsibleState.Expanded;
        }
        catch (ex) {
            if (ex instanceof Promises.TimeoutError) {
                ex.promise.then(() => this.triggerChange(false));
            }

            // Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
            // https://github.com/microsoft/vscode/issues/54806 & https://github.com/microsoft/vscode/issues/62214
            state = TreeItemCollapsibleState.Collapsed;
        }

        const item = new TreeItem(label || 'files changed', state);
        item.contextValue = ResourceType.ResultsFiles;
        item.id = this.id;

        return item;
    }

    @gate()
    @debug()
    refresh(reset: boolean = false) {
        if (!reset) return;

        this._filesQueryResults = this.getFilesQueryResultsCore();
    }

    private _filesQueryResults: Promise<FilesQueryResults> | undefined;

    getFilesQueryResults() {
        if (this._filesQueryResults === undefined) {
            this._filesQueryResults = this.getFilesQueryResultsCore();
        }

        return this._filesQueryResults;
    }

    private async getFilesQueryResultsCore(): Promise<FilesQueryResults> {
        const diff = await Container.git.getDiffStatus(this.uri.repoPath!, this.ref1, this.ref2);

        return {
            label: `${Strings.pluralize('file', diff !== undefined ? diff.length : 0, { zero: 'No' })} changed`,
            diff: diff
        };
    }
}
