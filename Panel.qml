import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui
import "Schedule.js" as Schedule

Panel {
  id: root
  moduleName: "acrogenesis.theme-scheduler"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.45)
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property var timeOptions: Schedule.timeOptions(15)
  readonly property bool dropdownOpen: dayThemePicker.popupOpen
    || nightThemePicker.popupOpen || dayTimePicker.popupOpen || nightTimePicker.popupOpen
  readonly property bool solarMode: root.service && root.service.scheduleMode === "solar"
  // An inherited location is the common case and needs no controls, so the
  // coordinate fields stay folded away until asked for. Typing coordinates
  // makes the source "manual", which keeps them open on their own.
  property bool overrideLocation: false
  readonly property bool inheritingNow: root.service !== null
    && (root.service.locationSource === "weather"
      || root.service.locationSource === "timezone")
  readonly property bool locationInheritable:
    root.service !== null && root.service.locationInheritable
  readonly property bool coordinatesVisible: !root.inheritingNow || root.overrideLocation
  // PanelKeyCatcher sees keys before its children, so while a coordinate field
  // has focus its shortcuts have to stand down or "a" applies the theme instead
  // of typing.
  readonly property bool editingText: latitudeField.activeFocus || longitudeField.activeFocus

  function coordinateText(value) {
    return value === null || value === undefined ? "" : String(value)
  }

  function inheritedText(value, example) {
    return value === null || value === undefined ? example : String(value)
  }

  function open() {
    if (service) {
      service.now = new Date()
      service.refreshThemes()
    }
    controller.show()
  }

  function close() { controller.hide() }
  function toggle() { opened ? close() : open() }

  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(430))
    contentHeight: panel.fittedContentHeight(content.implicitHeight, Style.space(620))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.dropdownOpen || root.editingText
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) {
        if ((text === "a" || text === "A") && root.service) root.service.applyNow()
        else if ((text === "e" || text === "E") && root.service)
          root.service.setEnabled(!root.service.enabled)
      }

      Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: content.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: content
          width: parent.width
          spacing: Style.space(12)

          PanelHero {
            width: parent.width
            title: "Theme Scheduler"
            meta: !root.service ? "Service unavailable"
              : (root.service.enabled ? root.service.nextSwitchText : "Automatic switching is off")
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconComponent: Component {
              Text {
                text: root.service && root.service.period === "day" ? "󰖨" : "󰖔"
                textFormat: Text.PlainText
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          Toggle {
            width: parent.width
            label: "Automatic switching"
            description: root.solarMode
              ? "Follow the sun and catch up after sleep or restart."
              : "Use local time and catch up after sleep or restart."
            checked: root.service ? root.service.enabled : false
            foreground: root.foreground
            fontFamily: root.fontFamily
            enabled: root.service !== null
            onClicked: if (root.service) root.service.setEnabled(!root.service.enabled)
          }

          PanelSeparator { width: parent.width; foreground: root.foreground }

          PanelSectionHeader {
            text: "SCHEDULE"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          ButtonGroup {
            width: parent.width
            value: root.solarMode ? "solar" : "fixed"
            options: [
              { value: "fixed", label: "Fixed times" },
              { value: "solar", label: "Sunrise & sunset" }
            ]
            foreground: root.foreground
            fontFamily: root.fontFamily
            focusable: false
            onChanged: function(value) {
              if (root.service) root.service.updateSchedule({ scheduleMode: value })
            }
          }

          Column {
            width: parent.width
            spacing: Style.space(8)
            visible: root.solarMode

            // Where the sun is being computed for, and the only control most
            // people need: none. Omarchy already knows roughly where this
            // machine is, so the coordinate fields stay folded away.
            Row {
              width: parent.width
              spacing: Style.space(10)

              Text {
                anchors.verticalCenter: parent.verticalCenter
                width: parent.width
                  - (overrideButton.visible ? overrideButton.width + parent.spacing : 0)
                text: root.service ? root.service.locationSummary : ""
                textFormat: Text.PlainText
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.WordWrap
              }

              Button {
                id: overrideButton
                anchors.verticalCenter: parent.verticalCenter
                visible: root.locationInheritable
                text: root.coordinatesVisible ? "Use inherited" : "Set manually"
                tooltipText: root.service && !root.coordinatesVisible
                  ? "Enter coordinates instead of " + root.service.inheritedSummary : ""
                fontSize: Style.font.caption
                focusable: true
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: {
                  if (!root.coordinatesVisible) {
                    root.overrideLocation = true
                    return
                  }
                  root.overrideLocation = false
                  // Clearing the typed coordinates is what actually restores
                  // the inherited location; collapsing the fields alone would
                  // leave manual values silently in force.
                  if (root.service && root.service.locationSource === "manual")
                    root.service.updateSchedule({ latitude: null, longitude: null })
                }
              }
            }

            Row {
              width: parent.width
              spacing: Style.space(10)
              visible: root.coordinatesVisible

              Column {
                width: (parent.width - parent.spacing) / 2
                spacing: Style.space(4)

                Text {
                  text: "Latitude"
                  textFormat: Text.PlainText
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }

                TextField {
                  id: latitudeField
                  width: parent.width
                  // An empty field inherits, so the placeholder shows what it
                  // is inheriting rather than an example from somewhere else.
                  placeholderText: root.inheritedText(
                    root.service ? root.service.resolvedLatitude : null, "-37.8136")
                  foreground: root.foreground
                  font.family: root.fontFamily
                  readonly property string committed:
                    root.service ? root.coordinateText(root.service.latitude) : ""
                  onCommittedChanged: if (!activeFocus) text = committed
                  Component.onCompleted: text = committed
                  onEditingFinished: {
                    if (root.service && text !== committed)
                      root.service.updateSchedule({ latitude: text })
                  }
                }
              }

              Column {
                width: (parent.width - parent.spacing) / 2
                spacing: Style.space(4)

                Text {
                  text: "Longitude"
                  textFormat: Text.PlainText
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }

                TextField {
                  id: longitudeField
                  width: parent.width
                  placeholderText: root.inheritedText(
                    root.service ? root.service.resolvedLongitude : null, "144.9631")
                  foreground: root.foreground
                  font.family: root.fontFamily
                  readonly property string committed:
                    root.service ? root.coordinateText(root.service.longitude) : ""
                  onCommittedChanged: if (!activeFocus) text = committed
                  Component.onCompleted: text = committed
                  onEditingFinished: {
                    if (root.service && text !== committed)
                      root.service.updateSchedule({ longitude: text })
                  }
                }
              }
            }

            // Today's computed times, so a wrong coordinate is obvious at a
            // glance against any almanac.
            Text {
              width: parent.width
              visible: root.service && root.service.solarAvailable
              text: root.service
                ? "Sunrise " + root.service.sunriseText + " · Sunset " + root.service.sunsetText
                  + (root.service.solarActive && (root.service.dayOffset || root.service.nightOffset)
                    ? "  →  switches " + root.service.dayStartText
                      + " · " + root.service.nightStartText : "")
                : ""
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WordWrap
            }

            Text {
              width: parent.width
              visible: root.service && root.service.solarNotice !== ""
              text: root.service ? root.service.solarNotice : ""
              textFormat: Text.PlainText
              color: root.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }

            Row {
              width: parent.width
              spacing: Style.space(10)

              NumberField {
                label: "Sunrise offset"
                value: root.service ? root.service.dayOffset : 0
                from: -120
                to: 120
                stepSize: 15
                foreground: root.foreground
                fontFamily: root.fontFamily
                onModified: function(value) {
                  if (root.service) root.service.updateSchedule({ dayOffset: value })
                }
              }

              NumberField {
                label: "Sunset offset"
                value: root.service ? root.service.nightOffset : 0
                from: -120
                to: 120
                stepSize: 15
                foreground: root.foreground
                fontFamily: root.fontFamily
                onModified: function(value) {
                  if (root.service) root.service.updateSchedule({ nightOffset: value })
                }
              }
            }
          }

          PanelSeparator { width: parent.width; foreground: root.foreground }

          PanelSectionHeader {
            text: "DAY"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Row {
            width: parent.width
            spacing: Style.space(10)

            SearchableDropdown {
              id: dayThemePicker
              width: parent.width
                - (dayTimePicker.visible ? dayTimePicker.width + parent.spacing : 0)
              label: "Theme"
              value: root.service ? root.service.dayTheme : ""
              options: root.service ? root.service.dayThemeOptions : []
              placeholderText: "Search themes..."
              foreground: root.foreground
              fontFamily: root.fontFamily
              onChanged: function(value) { if (root.service) root.service.updateSchedule({ dayTheme: value }) }
            }

            Dropdown {
              id: dayTimePicker
              visible: !root.solarMode
              width: Style.space(110)
              label: "Starts"
              value: root.service ? String(root.service.dayStart) : "420"
              options: root.timeOptions
              foreground: root.foreground
              fontFamily: root.fontFamily
              onChanged: function(value) { if (root.service) root.service.updateSchedule({ dayStart: Number(value) }) }
            }
          }

          PanelSectionHeader {
            text: "NIGHT"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Row {
            width: parent.width
            spacing: Style.space(10)

            SearchableDropdown {
              id: nightThemePicker
              width: parent.width
                - (nightTimePicker.visible ? nightTimePicker.width + parent.spacing : 0)
              label: "Theme"
              value: root.service ? root.service.nightTheme : ""
              options: root.service ? root.service.nightThemeOptions : []
              placeholderText: "Search themes..."
              foreground: root.foreground
              fontFamily: root.fontFamily
              onChanged: function(value) { if (root.service) root.service.updateSchedule({ nightTheme: value }) }
            }

            Dropdown {
              id: nightTimePicker
              visible: !root.solarMode
              width: Style.space(110)
              label: "Starts"
              value: root.service ? String(root.service.nightStart) : "1140"
              options: root.timeOptions
              foreground: root.foreground
              fontFamily: root.fontFamily
              onChanged: function(value) { if (root.service) root.service.updateSchedule({ nightStart: Number(value) }) }
            }
          }

          PanelSeparator { width: parent.width; foreground: root.foreground }

          Column {
            width: parent.width
            spacing: Style.space(5)

            Text {
              width: parent.width
              text: root.service ? "Current: " + root.service.currentTheme
                + " · Scheduled: " + root.service.desiredTheme : ""
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WordWrap
            }

            Text {
              visible: root.service && (root.service.lastError !== "" || root.service.lastAction !== "")
              width: parent.width
              text: root.service && root.service.lastError !== ""
                ? root.service.lastError : (root.service ? root.service.lastAction : "")
              textFormat: Text.PlainText
              color: root.service && root.service.lastError !== "" ? root.urgent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }
          }

          Button {
            width: parent.width
            text: root.service && root.service.switchBusy ? "Applying…" : "Apply scheduled theme now"
            iconText: "󰑐"
            bordered: true
            focusable: true
            enabled: root.service && !root.service.switchBusy
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: if (root.service) root.service.applyNow()
          }

          Text {
            width: parent.width
            text: "Manual theme choices remain in place until the next scheduled boundary. Middle-click the bar icon to apply immediately."
            textFormat: Text.PlainText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }
        }
      }
    }
  }
}
