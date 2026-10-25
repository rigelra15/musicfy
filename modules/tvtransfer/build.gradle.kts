// Phone -> TV transfer, the phone's half: the pairing code, the encryption and the portable backup
// format. Plain JVM on purpose (no Android classes), so every rule here is tested on a computer
// and the Android screen that scans the code and picks the data only has to call it.
plugins {
    alias(libs.plugins.kotlin.serialization)
    id("kotlin")
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    // QR decoding only (pure Java, Apache-2.0, no Google Play services: the F-Droid build keeps working)
    implementation("com.google.zxing:core:3.5.3")
    testImplementation(libs.junit)
}
