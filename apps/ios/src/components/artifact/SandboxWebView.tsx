import { Linking, StyleSheet } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { fileNavigationDecision, navigationDecision, sandboxProps, type NavigationDecision } from '../../artifacts/sandbox';

type Content = { kind: 'html'; html: string } | { kind: 'file'; uri: string };

interface SandboxWebViewProps {
  content: Content;
  scripts: boolean;
  background: string;
  label: string;
}

/**
 * The only web view an artifact is shown in. It takes content, never a URL on the server, and holds no token. See
 * `artifacts/sandbox.ts` for what it allows and why.
 */
export function SandboxWebView({ content, scripts, background, label }: SandboxWebViewProps) {
  const decide = (request: WebViewNavigation): NavigationDecision =>
    content.kind === 'file' ? fileNavigationDecision(request, content.uri) : navigationDecision(request);

  return (
    <WebView
      {...sandboxProps({ scripts })}
      accessibilityLabel={label}
      source={content.kind === 'html' ? { html: content.html } : { uri: content.uri }}
      allowingReadAccessToURL={content.kind === 'file' ? content.uri : undefined}
      onShouldStartLoadWithRequest={(request) => {
        const decision = decide(request);
        if (decision === 'external') void Linking.openURL(request.url);
        return decision === 'allow';
      }}
      style={[styles.web, { backgroundColor: background }]}
    />
  );
}

const styles = StyleSheet.create({
  web: {
    flex: 1,
  },
});
