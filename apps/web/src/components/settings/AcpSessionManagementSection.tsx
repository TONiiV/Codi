import {
  AuthOrchestrationOperateScope,
  AuthProvidersManageScope,
  AuthOrchestrationReadScope,
} from "@t3tools/contracts";
import { useEnvironmentScope, readEnvironmentScope } from "~/state/session";
import type {
  AcpRegistryConfigurableProvider,
  AcpRegistrySession,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { englishT } from "~/i18n/englishT";

interface AcpSessionProject {
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

function reportFailure(
  title: string,
  result: AtomCommandResult<unknown, unknown>,
  t: TFunction = englishT,
) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : t("settings.text.theAcpOperationFailed"),
  });
}

function parseProviderHeaders(
  text: string,
  t: TFunction = englishT,
):
  | { readonly ok: true; readonly headers: Record<string, string> | undefined }
  | { readonly ok: false; readonly error: string } {
  if (text.trim().length === 0) return { ok: true, headers: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : t("settings.text.headersMustBeValidJson"),
    };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((value) => typeof value === "string")
  ) {
    return { ok: false, error: t("settings.parallelProviders.headersMustBeJsonObject") };
  }
  return { ok: true, headers: parsed as Record<string, string> };
}

export function AcpSessionManagementSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider;
  readonly projects: ReadonlyArray<AcpSessionProject>;
  readonly readOnly: boolean;
}) {
  const { t } = useTranslation();
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const canRead = useEnvironmentScope(props.environmentId, AuthOrchestrationReadScope);
  const [projectId, setProjectId] = useState<ProjectId | null>(props.projects[0]?.id ?? null);
  const [sessions, setSessions] = useState<ReadonlyArray<AcpRegistrySession>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importingSessionId, setImportingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [providers, setProviders] = useState<ReadonlyArray<AcpRegistryConfigurableProvider>>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<
    Readonly<Record<string, { apiType: string; baseUrl: string; headers: string }>>
  >({});
  const listSessions = useAtomCommand(serverEnvironment.listAcpRegistrySessions, {
    reportFailure: false,
  });
  const importSession = useAtomCommand(serverEnvironment.importAcpRegistrySession, {
    reportFailure: false,
  });
  const deleteSession = useAtomCommand(serverEnvironment.deleteAcpRegistrySession, {
    reportFailure: false,
  });
  const listProviders = useAtomCommand(serverEnvironment.listAcpRegistryProviders, {
    reportFailure: false,
  });
  const setProvider = useAtomCommand(serverEnvironment.setAcpRegistryProvider, {
    reportFailure: false,
  });
  const disableProvider = useAtomCommand(serverEnvironment.disableAcpRegistryProvider, {
    reportFailure: false,
  });
  const logout = useAtomCommand(serverEnvironment.logoutAcpRegistry, { reportFailure: false });
  const canList = props.provider.nativeSessions?.canList === true;
  const canImport =
    props.provider.nativeSessions?.canLoad === true ||
    props.provider.nativeSessions?.canResume === true;
  const canLogout =
    props.provider.auth.canLogout === true && !props.provider.setup?.canAuthenticate;
  const canDelete = props.provider.nativeSessions?.canDelete === true;
  const canConfigureProviders = props.provider.configurableProviders === true;
  const projectOperationPending =
    loading ||
    importingSessionId !== null ||
    deletingSessionId !== null ||
    loadingProviders ||
    savingProviderId !== null;

  if (!canList && !canLogout && !canConfigureProviders) return null;

  const loadSessions = async (cursor?: string) => {
    if (projectId === null || loading) return;
    setLoading(true);
    const result = await listSessions({
      environmentId: props.environmentId,
      input: {
        instanceId: props.instanceId,
        projectId,
        ...(cursor === undefined ? {} : { cursor }),
      },
    });
    setLoading(false);
    if (result._tag === "Success") {
      setSessions((current) =>
        cursor === undefined ? result.value.sessions : [...current, ...result.value.sessions],
      );
      setNextCursor(result.value.nextCursor);
      return;
    }
    reportFailure(t("settings.text.couldNotListAcpSessions"), result, t);
  };

  const importNativeSession = async (session: AcpRegistrySession) => {
    if (
      !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope) ||
      projectId === null ||
      importingSessionId !== null
    )
      return;
    setImportingSessionId(session.sessionId);
    const result = await importSession({
      environmentId: props.environmentId,
      input: {
        instanceId: props.instanceId,
        projectId,
        sessionId: session.sessionId,
        title: session.title,
        updatedAt: session.updatedAt,
      },
    });
    setImportingSessionId(null);
    if (result._tag === "Success") {
      setSessions((current) =>
        current.map((candidate) =>
          candidate.sessionId === session.sessionId
            ? { ...candidate, importedThreadId: result.value.threadId }
            : candidate,
        ),
      );
      toastManager.add({
        type: "success",
        title: result.value.imported
          ? t("settings.text.acpSessionImported")
          : t("settings.text.acpSessionAlreadyImported"),
      });
      return;
    }
    reportFailure(t("settings.text.couldNotImportAcpSession"), result, t);
  };

  const deleteNativeSession = async (session: AcpRegistrySession) => {
    if (projectId === null || deletingSessionId !== null || session.importedThreadId !== null)
      return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      t("settings.parallelProviders.deleteNativeSessionConfirm", {
        session: session.title ?? session.sessionId,
      }),
      { variant: "destructive" },
    );
    if (!confirmed || !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope))
      return;
    setDeletingSessionId(session.sessionId);
    const result = await deleteSession({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, projectId, sessionId: session.sessionId },
    });
    setDeletingSessionId(null);
    if (result._tag === "Success") {
      setSessions((current) =>
        current.filter((candidate) => candidate.sessionId !== session.sessionId),
      );
      toastManager.add({ type: "success", title: t("settings.text.acpSessionDeleted") });
      return;
    }
    reportFailure(t("settings.text.couldNotDeleteAcpSession"), result, t);
  };

  const loadProviders = async (resetProviderId?: string) => {
    if (projectId === null || loadingProviders) return;
    setLoadingProviders(true);
    const result = await listProviders({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, projectId },
    });
    setLoadingProviders(false);
    if (result._tag === "Success") {
      setProviders(result.value.providers);
      setProviderDrafts((current) =>
        Object.fromEntries(
          result.value.providers.map((provider) => [
            provider.providerId,
            (resetProviderId !== undefined && provider.providerId !== resetProviderId
              ? current[provider.providerId]
              : undefined) ?? {
              apiType: provider.current?.apiType ?? provider.supported[0] ?? "",
              baseUrl: provider.current?.baseUrl ?? "",
              headers: "",
            },
          ]),
        ),
      );
      return;
    }
    reportFailure(t("settings.text.couldNotListAcpProviders"), result, t);
  };

  const saveProvider = async (provider: AcpRegistryConfigurableProvider) => {
    if (
      !readEnvironmentScope(props.environmentId, AuthProvidersManageScope) ||
      projectId === null ||
      savingProviderId !== null ||
      loadingProviders
    )
      return;
    const draft = providerDrafts[provider.providerId];
    if (draft === undefined || draft.apiType.length === 0 || draft.baseUrl.length === 0) return;
    const parsedHeaders = parseProviderHeaders(draft.headers, t);
    if (!parsedHeaders.ok) {
      toastManager.add({
        type: "error",
        title: t("settings.text.invalidProviderHeaders"),
        description: parsedHeaders.error,
      });
      return;
    }
    const headers = parsedHeaders.headers;
    setSavingProviderId(provider.providerId);
    const result = await setProvider({
      environmentId: props.environmentId,
      input: {
        instanceId: props.instanceId,
        projectId,
        providerId: provider.providerId,
        apiType: draft.apiType,
        baseUrl: draft.baseUrl,
        ...(headers === undefined ? {} : { headers }),
      },
    });
    setSavingProviderId(null);
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: t("settings.text.acpProviderConfigured") });
      await loadProviders(provider.providerId);
      return;
    }
    reportFailure(t("settings.text.couldNotConfigureAcpProvider"), result, t);
  };

  const disableConfiguredProvider = async (provider: AcpRegistryConfigurableProvider) => {
    if (projectId === null || savingProviderId !== null || loadingProviders || provider.required)
      return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      t("settings.text.disableAcpProviderProviderid", { providerId: provider.providerId }),
      { variant: "destructive" },
    );
    if (!confirmed || !readEnvironmentScope(props.environmentId, AuthProvidersManageScope)) return;
    setSavingProviderId(provider.providerId);
    const result = await disableProvider({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, projectId, providerId: provider.providerId },
    });
    setSavingProviderId(null);
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: t("settings.text.acpProviderDisabled") });
      await loadProviders(provider.providerId);
      return;
    }
    reportFailure(t("settings.text.couldNotDisableAcpProvider"), result, t);
  };

  const logoutProvider = async () => {
    if (loggingOut || !readEnvironmentScope(props.environmentId, AuthProvidersManageScope)) return;
    setLoggingOut(true);
    const result = await logout({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId },
    });
    setLoggingOut(false);
    if (result._tag === "Success") {
      setSessions([]);
      setNextCursor(null);
      toastManager.add({ type: "success", title: t("settings.text.loggedOutOfAcpAgent") });
      return;
    }
    reportFailure(t("settings.text.couldNotLogOutOfAcp"), result, t);
  };

  return (
    <div className="grid gap-3">
      <SettingsRow
        title={t("settings.text.nativeSessions")}
        description={t("settings.text.resumeAgentOwnedConversationsAsT3")}
        status={
          canList && props.projects.length === 0
            ? t("settings.parallelProviders.addProjectBeforeImporting")
            : undefined
        }
        control={
          <div className="flex flex-wrap items-center gap-2">
            {canLogout ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={props.readOnly || loggingOut}
                onClick={() => void logoutProvider()}
              >
                {loggingOut ? t("settings.text.loggingOut") : t("settings.text.logOut")}
              </Button>
            ) : null}
            {canList && props.projects.length > 0 ? (
              <>
                <Select
                  value={projectId ?? ""}
                  disabled={!canRead || projectOperationPending}
                  onValueChange={(value) => {
                    if (value === null) return;
                    setProjectId(value as ProjectId);
                    setSessions([]);
                    setNextCursor(null);
                    setProviders([]);
                    setProviderDrafts({});
                  }}
                >
                  <SelectTrigger
                    aria-label={t("settings.text.projectForAcpSessions")}
                    className="w-40"
                    size="sm"
                  >
                    <SelectValue>
                      {props.projects.find((project) => project.id === projectId)?.title}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {props.projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canRead || loading || projectId === null}
                  onClick={() => void loadSessions()}
                >
                  {loading
                    ? t("settings.text.loading")
                    : sessions.length === 0
                      ? t("settings.text.listSessions")
                      : t("settings.text.refresh")}
                </Button>
              </>
            ) : null}
          </div>
        }
      >
        {canList && (sessions.length > 0 || nextCursor !== null) ? (
          <>
            {sessions.length > 0 ? (
              <div className="divide-y divide-border/60 border-y border-border/60">
                {sessions.map((session) => (
                  <div
                    key={session.sessionId}
                    className="flex min-w-0 items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs text-foreground">
                        {session.title ?? session.sessionId}
                      </p>
                      <code className="block truncate text-3xs text-muted-foreground">
                        {session.sessionId}
                      </code>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost-muted"
                        disabled={
                          !canOperate ||
                          !canImport ||
                          session.importedThreadId !== null ||
                          importingSessionId !== null
                        }
                        onClick={() => void importNativeSession(session)}
                      >
                        {session.importedThreadId !== null
                          ? t("settings.text.imported")
                          : importingSessionId === session.sessionId
                            ? t("settings.text.importing")
                            : t("settings.text.import")}
                      </Button>
                      {canDelete ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost-muted"
                          disabled={
                            !canOperate ||
                            session.importedThreadId !== null ||
                            deletingSessionId !== null
                          }
                          onClick={() => void deleteNativeSession(session)}
                        >
                          {deletingSessionId === session.sessionId
                            ? t("settings.text.deleting")
                            : t("settings.text.delete")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {nextCursor !== null ? (
              <Button
                type="button"
                size="xs"
                variant="ghost-muted"
                className="w-fit"
                disabled={!canRead || loading}
                onClick={() => void loadSessions(nextCursor)}
              >
                {loading ? t("settings.text.loading") : t("settings.text.loadMore")}
              </Button>
            ) : null}
          </>
        ) : null}
      </SettingsRow>

      {canConfigureProviders ? (
        <div className="grid gap-3 border-t border-border/60 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-foreground">
                {t("settings.text.agentProviders")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.text.configureNonSecretRoutingHeadersAre")}
              </p>
            </div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={
                !canRead || loadingProviders || savingProviderId !== null || projectId === null
              }
              onClick={() => void loadProviders()}
            >
              {loadingProviders
                ? t("settings.text.loading")
                : providers.length === 0
                  ? t("settings.text.listProviders")
                  : t("settings.text.refresh")}
            </Button>
          </div>

          {!canList && props.projects.length > 1 ? (
            <Select
              value={projectId ?? ""}
              disabled={!canRead || projectOperationPending}
              onValueChange={(value) => {
                if (value === null) return;
                setProjectId(value as ProjectId);
                setProviders([]);
                setProviderDrafts({});
              }}
            >
              <SelectTrigger
                aria-label={t("settings.text.projectForAcpProviders")}
                className="min-w-48"
                size="xs"
              >
                <SelectValue>
                  {props.projects.find((project) => project.id === projectId)?.title}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {props.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}

          {providers.length > 0 ? (
            <div className="divide-y divide-border/60 border-y border-border/60">
              {providers.map((provider) => {
                const draft = providerDrafts[provider.providerId] ?? {
                  apiType: provider.current?.apiType ?? provider.supported[0] ?? "",
                  baseUrl: provider.current?.baseUrl ?? "",
                  headers: "",
                };
                const updateDraft = (update: Partial<typeof draft>) =>
                  setProviderDrafts((current) => ({
                    ...current,
                    [provider.providerId]: { ...draft, ...update },
                  }));
                return (
                  <div key={provider.providerId} className="grid gap-2 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">
                          {provider.providerId}
                        </p>
                        <p className="text-3xs text-muted-foreground">
                          {provider.current === null
                            ? t("settings.text.disabled")
                            : t("settings.text.configured")}
                          {provider.required ? t("settings.text.required") : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={
                            props.readOnly ||
                            savingProviderId !== null ||
                            loadingProviders ||
                            draft.apiType.length === 0 ||
                            draft.baseUrl.length === 0
                          }
                          onClick={() => void saveProvider(provider)}
                        >
                          {savingProviderId === provider.providerId
                            ? t("settings.text.saving")
                            : t("settings.text.save")}
                        </Button>
                        {!provider.required && provider.current !== null ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost-muted"
                            disabled={
                              props.readOnly || savingProviderId !== null || loadingProviders
                            }
                            onClick={() => void disableConfiguredProvider(provider)}
                          >
                            {t("settings.text.disable")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                      <Select
                        value={draft.apiType}
                        disabled={props.readOnly || savingProviderId !== null}
                        onValueChange={(value) => {
                          if (value !== null) updateDraft({ apiType: value });
                        }}
                      >
                        <SelectTrigger
                          aria-label={t("settings.text.provideridProtocol", {
                            providerId: provider.providerId,
                          })}
                          size="sm"
                        >
                          <SelectValue>{draft.apiType}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {provider.supported.map((protocol) => (
                            <SelectItem key={protocol} value={protocol}>
                              {protocol}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <Input
                        size="sm"
                        type="url"
                        aria-label={t("settings.text.provideridBaseUrl", {
                          providerId: provider.providerId,
                        })}
                        placeholder="https://api.example.com"
                        value={draft.baseUrl}
                        disabled={props.readOnly || savingProviderId !== null}
                        onValueChange={(value) => updateDraft({ baseUrl: value })}
                      />
                    </div>
                    <Input
                      size="sm"
                      type="password"
                      aria-label={t("settings.text.provideridWriteOnlyHeadersJson", {
                        providerId: provider.providerId,
                      })}
                      placeholder={t("settings.text.writeOnlyHeadersJsonEG")}
                      value={draft.headers}
                      disabled={props.readOnly || savingProviderId !== null}
                      onValueChange={(value) => updateDraft({ headers: value })}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
