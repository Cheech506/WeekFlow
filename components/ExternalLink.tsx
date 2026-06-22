import { type Href, Link } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { type ComponentProps } from 'react';
import { Platform } from 'react-native';

type ExternalLinkProps = Omit<
  ComponentProps<typeof Link>,
  'href'
> & {
  href: Href;
};

export function ExternalLink({
  href,
  ...rest
}: ExternalLinkProps) {
  return (
    <Link
      target="_blank"
      {...rest}
      href={href}
      onPress={async (event) => {
        /*
         * Native devices open external links through Expo's
         * in-app browser. Web keeps the normal browser behavior.
         */
        if (Platform.OS !== 'web') {
          event.preventDefault();

          await openBrowserAsync(String(href));
        }
      }}
    />
  );
}