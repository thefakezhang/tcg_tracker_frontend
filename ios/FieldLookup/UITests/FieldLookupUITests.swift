import XCTest

final class FieldLookupUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testJapaneseResultAndDecisionDetailAtPhoneSize() throws {
        let app = launch(scenario: "live-japanese")
        let result = app.buttons["card-101"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertTrue(result.isHittable)
        result.tap()

        XCTAssertTrue(app.staticTexts["ピカチュウ"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["JP → NA"].exists)
        XCTAssertTrue(app.staticTexts["Sold comp"].exists)
        XCTAssertTrue(app.staticTexts["50.0%"].exists)
        attachScreenshot(name: "field-lookup-japanese-detail", app: app)

        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Owned across grades"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["Source observation time is unavailable from the summary API."].exists)
        attachScreenshot(name: "field-lookup-japanese-detail-freshness", app: app)
    }

    func testOfflineStaleAndUnknownStockAreExplicit() throws {
        let app = launch(scenario: "offline-stale")
        XCTAssertTrue(app.otherElements["stale-cache-banner"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Offline cached result - stale"].exists)
        let result = app.buttons["card-101"]
        XCTAssertTrue(result.isHittable)
        result.tap()
        app.swipeUp()
        XCTAssertTrue(app.otherElements["unknown-stock"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["The stock request failed. This is not a zero count."].exists)
        attachScreenshot(name: "field-lookup-offline-stale", app: app)
    }

    func testRetryRecoversFromNetworkFailure() throws {
        let app = launch(scenario: "retry")
        XCTAssertTrue(app.otherElements["lookup-error"].waitForExistence(timeout: 5))
        let retry = app.buttons["retry-button"]
        XCTAssertTrue(retry.isHittable)
        XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
        retry.tap()
        XCTAssertTrue(app.buttons["card-101"].waitForExistence(timeout: 3))
        attachScreenshot(name: "field-lookup-retry-recovered", app: app)
    }

    func testExpiredSessionExplainsRecovery() throws {
        let app = launch(scenario: "session-expired")
        XCTAssertTrue(app.otherElements["session-message"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Your session expired. Sign in again to continue."].exists)
        let signIn = app.buttons["google-sign-in"]
        XCTAssertTrue(signIn.isHittable)
        XCTAssertGreaterThanOrEqual(signIn.frame.height, 44)
        attachScreenshot(name: "field-lookup-session-expired", app: app)
    }

    func testLoadingStateIsReadable() throws {
        let app = launch(scenario: "loading")
        XCTAssertTrue(app.otherElements["lookup-loading"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Loading current summaries"].exists)
        attachScreenshot(name: "field-lookup-loading", app: app)
    }

    private func launch(scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-scenario", scenario]
        app.launch()
        return app
    }

    private func attachScreenshot(name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
