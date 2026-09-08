package app.crossscreen.android.ui.components

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.AnnotatedString

/**
 * A 6-digit session code entry field (design/mobile spec §8, matching
 * architecture §7: the code is a lookup key, not a secret, so there is
 * nothing here to mask).
 *
 * Digits only, capped at 6, grouped as "482 719" for display while the
 * underlying value stays plain digits — the same split the web Join screen
 * makes between `normaliseJoinCode` and `formatJoinCode` in
 * packages/protocol, done here with a `VisualTransformation` instead of two
 * functions since Compose already has the tool for it.
 *
 * A paste containing a share link rather than a bare code, and a numeric
 * keyboard that also accepts a pasted URL, are join-flow behaviour — they
 * belong with the networking wiring, not this field.
 */
@Composable
fun SessionCodeField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String = "Session code",
) {
    OutlinedTextField(
        value = value,
        onValueChange = { raw ->
            val digitsOnly = raw.filter { it.isDigit() }.take(6)
            onValueChange(digitsOnly)
        },
        modifier = modifier,
        label = { Text(label) },
        placeholder = { Text("482 719") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        visualTransformation = GroupedDigitsTransformation,
        textStyle = MaterialTheme.typography.headlineMedium,
        singleLine = true,
    )
}

/** "482719" -> "482 719", the same grouping architecture §7 defines for display everywhere else. */
private object GroupedDigitsTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val digits = text.text
        val grouped = if (digits.length > 3) {
            "${digits.take(3)} ${digits.drop(3)}"
        } else {
            digits
        }

        val offsetMapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int =
                if (offset <= 3) offset else offset + 1

            override fun transformedToOriginal(offset: Int): Int =
                if (offset <= 3) offset else (offset - 1).coerceAtMost(digits.length)
        }

        return TransformedText(AnnotatedString(grouped), offsetMapping)
    }
}
