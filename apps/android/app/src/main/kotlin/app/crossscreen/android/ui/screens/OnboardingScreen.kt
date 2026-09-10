package app.crossscreen.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.ScreenShare
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.MinTouchTarget
import app.crossscreen.android.ui.theme.Spacing
import kotlinx.coroutines.launch

/**
 * design/mobile spec §4B: three slides — Share, Connect, Secure — with
 * Skip, Next, and Get Started. Shown once, on first launch only
 * (MainActivity persists that it has been seen).
 *
 * The "Secure" copy names encrypted WebRTC media deliberately: architecture
 * §7 is explicit that 1:1 DTLS-SRTP already is end-to-end encryption, so
 * this is a true statement to make to the user, not marketing.
 */
private data class OnboardingPage(
    val icon: ImageVector,
    val title: String,
    val body: String,
)

private val pages = listOf(
    OnboardingPage(
        icon = Icons.AutoMirrored.Filled.ScreenShare,
        title = "Share",
        body = "Share your screen with anyone, from this device.",
    ),
    OnboardingPage(
        icon = Icons.AutoMirrored.Filled.Login,
        title = "Connect",
        body = "Join using a short session code or a link.",
    ),
    OnboardingPage(
        icon = Icons.Filled.Lock,
        title = "Secure",
        body = "Private sessions, with encrypted WebRTC media end to end.",
    ),
)

@Composable
fun OnboardingScreen(onFinish: () -> Unit) {
    val pagerState = rememberPagerState(pageCount = { pages.size })
    val scope = rememberCoroutineScope()
    // A plain read in composition — cheap, and recomposition already tracks
    // pagerState.currentPage, so no derivedStateOf needed.
    val onLastPage = pagerState.currentPage == pages.lastIndex

    Column(modifier = Modifier.fillMaxSize().padding(Spacing.lg)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = onFinish) { Text("Skip") }
        }

        HorizontalPager(
            state = pagerState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) { pageIndex ->
            val page = pages[pageIndex]
            Column(
                modifier = Modifier.fillMaxSize().padding(Spacing.lg),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(
                    page.icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(64.dp),
                )
                Text(
                    page.title,
                    style = MaterialTheme.typography.headlineLarge,
                    modifier = Modifier.padding(top = Spacing.xl),
                )
                Text(
                    page.body,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = Spacing.sm),
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.lg),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(pages.size) { index ->
                val selected = index == pagerState.currentPage
                Box(
                    modifier = Modifier
                        .padding(horizontal = Spacing.xs)
                        .size(if (selected) 10.dp else 8.dp)
                        .background(
                            color = if (selected) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.outline
                            },
                            shape = CircleShape,
                        ),
                )
            }
        }

        Button(
            onClick = {
                if (onLastPage) {
                    onFinish()
                } else {
                    scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MinTouchTarget),
        ) {
            Text(if (onLastPage) "Get Started" else "Next")
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PreviewOnboardingScreen() {
    CrossScreenTheme {
        OnboardingScreen(onFinish = {})
    }
}
