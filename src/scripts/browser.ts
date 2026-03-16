export const SUPPORTED_BROWSERS = [
  "Safari",
  "Arc",
  "Google Chrome",
  "Microsoft Edge",
  "Brave Browser",
  "Firefox",
  "Opera",
  "Vivaldi",
];

export const GET_ACTIVE_APP_SCRIPT = `
tell application "System Events"
    set activeApp to name of first application process whose frontmost is true
    return activeApp
end tell
`;

const getLinkFromArcScript = (separator: string) => `
tell application "Arc"
    if (count of windows) > 0 then
        return URL of active tab of front window & "${separator}" & title of active tab of front window
    else
        error "Arc is not displaying a web page!"
    end if
end tell
`;

const getLinkFromSafariScript = (separator: string) => `
tell application "Safari"
    if (exists front document) then
        return URL of front document & "${separator}" & name of front document
    else
        error "Safari is not displaying a web page!"
    end if
end tell
`;

export const GET_LINK_FROM_BROWSER_SCRIPT = (browser: string, separator = "\\t") => {
  if (browser == "Safari") {
    return getLinkFromSafariScript(separator);
  } else if (browser == "Arc") {
    return getLinkFromArcScript(separator);
  } else {
    return `
        tell application "${browser}"
            if (exists active tab of front window) then
                return URL of active tab of front window & "${separator}" & title of active tab of front window
            else
                error "${browser} is not displaying a web page!"
            end if
        end tell`;
  }
};
